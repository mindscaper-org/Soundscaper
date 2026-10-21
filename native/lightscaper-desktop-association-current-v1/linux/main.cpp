/* SPDX-License-Identifier: AGPL-3.0-only */
#include "files.hpp"
#include "process.hpp"
#include "strict_json.hpp"
#include <gio/gdesktopappinfo.h>
#include <cstring>
#include <exception>
#include <iostream>
#include <memory>
#include <set>

#if defined(__linux__) && defined(__x86_64__)
static constexpr auto target = "linux-x64";
#elif defined(__linux__) && defined(__aarch64__)
static constexpr auto target = "linux-arm64";
#else
#error Only maintained target-native Linux architectures are admitted.
#endif
namespace json = framescaper::media::json;
using namespace association;
static constexpr auto mime = "application/vnd.lightscaper.liscape+zip";
struct native_error final : std::runtime_error {
  std::string domain; int code;
  native_error(std::string area, int value, const std::string& message) : std::runtime_error(message), domain(std::move(area)), code(value) {}
};
static void gio_error(GError*& error, const std::string& fallback) {
  if (!error) throw native_error("GIO", 0, fallback);
  const auto* domain = g_quark_to_string(error->domain);
  native_error failure(domain ? domain : "GIO", error->code, error->message);
  g_clear_error(&error); throw failure;
}
static std::string text(const json::value& row, std::string_view key) { return std::string(json::string(json::member(row, key), key)); }
static std::int64_t number(const json::value& row, std::string_view key) { return json::integer(json::member(row, key), key); }
struct request {
  std::string nonce, revision, executable, archive, sha; pid_t primary{};
};
static request read_request(const std::string& bytes) {
  const auto row = json::parse(compact(bytes));
  require(row.kind == json::type::object && row.members.size() == 9, "Request must be a closed nine-key record.");
  std::set<std::string> keys{"schemaVersion", "nonce", "target", "sourceRevision", "operation", "executablePath", "archivePath", "archiveSha256", "primaryPid"};
  for (const auto& member : row.members) require(keys.erase(member.first) == 1, "Unknown request member.");
  require(keys.empty() && number(row, "schemaVersion") == 1 && text(row, "target") == target && text(row, "operation") == "open", "Native target/schema/operation differs.");
  request input{text(row, "nonce"), text(row, "sourceRevision"), text(row, "executablePath"), text(row, "archivePath"), text(row, "archiveSha256"), 0};
  const auto pid = number(row, "primaryPid");
  require(hex(input.nonce, 32) && hex(input.revision, 40) && hex(input.sha, 64) && pid > 0 && pid <= INT_MAX, "Native request identity is invalid.");
  input.primary = static_cast<pid_t>(pid); return input;
}
struct counters { unsigned content{}, defaults{}, launches{}, callbacks{}; };
static std::string encode_counters(const counters& value) {
  return encode({{"contentTypeQueries", std::to_string(value.content)}, {"defaultHandlerQueries", std::to_string(value.defaults)},
    {"launchCalls", std::to_string(value.launches)}, {"pidCallbacks", std::to_string(value.callbacks)}});
}
using app_ptr = std::unique_ptr<GAppInfo, decltype(&g_object_unref)>;
struct selected {
  app_ptr app{nullptr, g_object_unref}; std::string desktop, id, command, bytes, content_type, mime_type;
};
static selected resolve_default(GFile* archive, const request& input, counters& count, object& report) {
  GError* error = nullptr; ++count.content;
  std::unique_ptr<GFileInfo, decltype(&g_object_unref)> info(g_file_query_info(archive, G_FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE,
    G_FILE_QUERY_INFO_NOFOLLOW_SYMLINKS, nullptr, &error), g_object_unref);
  if (!info || error) gio_error(error, "Actual archive content type is unavailable.");
  const auto* type = g_file_info_get_content_type(info.get()); require(type != nullptr, "Actual archive content type is absent.");
  gchar* mapped = g_content_type_get_mime_type(type); require(mapped != nullptr, "Actual archive MIME mapping is absent.");
  std::string actual_type(type), actual_mime(mapped); g_free(mapped);
  report["contentType"] = quote(actual_type); report["mimeType"] = quote(actual_mime);
  require(actual_type == mime && actual_mime == mime, "Actual archive content type is not the product-owned catalog MIME.");
  ++count.defaults; app_ptr app(g_file_query_default_handler(archive, nullptr, &error), g_object_unref);
  if (!app || error) gio_error(error, "Actual default handler is unavailable.");
  require(G_IS_DESKTOP_APP_INFO(app.get()), "Actual default is not an installed desktop application.");
  auto* desktop_app = G_DESKTOP_APP_INFO(app.get());
  const char* filename = g_desktop_app_info_get_filename(desktop_app), *id = g_app_info_get_id(app.get());
  require(filename && id, "Actual default desktop identity is absent.");
  const auto desktop = canonical(filename, false);
  require(desktop.ends_with(".desktop") && desktop.substr(desktop.rfind('/') + 1) == id, "Actual default desktop ID differs from its installed filename.");
  report["desktopFile"] = quote(desktop); report["desktopId"] = quote(id);
  const auto desktop_bytes = regular(desktop, 65536, false);
  gchar* desktop_mime = g_desktop_app_info_get_string(desktop_app, "MimeType");
  const bool own_mime = desktop_mime && std::string(desktop_mime) == std::string(mime) + ';'; g_free(desktop_mime);
  const char* const* supported = g_app_info_get_supported_types(app.get());
  require(own_mime && supported && supported[0] && std::string(supported[0]) == mime && !supported[1], "Selected desktop advertises a foreign MIME or alias.");
  require(!g_desktop_app_info_get_boolean(desktop_app, "Terminal") && !g_desktop_app_info_get_boolean(desktop_app, "DBusActivatable") &&
    !g_desktop_app_info_get_is_hidden(desktop_app), "Default handler requires an unsupported terminal/DBus/hidden launcher.");
  gchar* kind = g_desktop_app_info_get_string(desktop_app, "Type"), *name = g_desktop_app_info_get_string(desktop_app, "Name");
  const bool own_name = kind && std::string(kind) == "Application" && name && std::string(name) == "Lightscaper"; g_free(kind); g_free(name);
  require(own_name, "Selected desktop name/type is foreign.");
  const char* command = g_app_info_get_commandline(app.get()), *executable = g_app_info_get_executable(app.get());
  if (command) report["exec"] = quote(command);
  require(command && executable && input.executable == executable, "Actual default executable differs from its accepted installed path.");
  int argc = 0; gchar** argv = nullptr;
  if (!g_shell_parse_argv(command, &argc, &argv, &error) || error) gio_error(error, "Installed Exec cannot be parsed.");
  const bool exact = argc == 2 && input.executable == argv[0] && std::string(argv[1]) == "%U"; g_strfreev(argv);
  require(exact, "Installed Exec must contain only its absolute executable and %U; no argument override is admitted.");
  return {std::move(app), desktop, id, command, desktop_bytes, actual_type, actual_mime};
}
struct launch_state {
  std::vector<child> children; std::exception_ptr failure; const request* input{}; GAppInfo* expected{}; pid_t group{}; counters* count{};
};
static void launched(GDesktopAppInfo* app, GPid pid, gpointer data) noexcept {
  auto& state = *static_cast<launch_state*>(data); ++state.count->callbacks;
  try {
    require(pid > 0 && state.children.size() < 16, "Native launcher child inventory is outside its bound.");
    state.children.push_back(child{pid, {}, false, false, false, 0}); auto& value = state.children.back();
    require(g_app_info_equal(G_APP_INFO(app), state.expected), "Native PID callback came from another handler.");
    value.identity = process_snapshot(pid); value.pinned = true;
    require(value.identity.group == state.group, "Native secondary escaped the helper calling group.");
  } catch (...) { if (!state.failure) state.failure = std::current_exception(); }
}
static bool cleanup(launch_state& state) {
  bool joined = true;
  for (auto& value : state.children) if (!value.waited) {
    const auto killed = kill(value.pid, SIGKILL), failure = killed == 0 ? 0 : errno;
    const auto reaped = reap(value, 2000); joined = joined && reaped && (killed == 0 || failure == ESRCH);
  }
  return joined;
}
static void perform(const request& input, object& report, counters& count, launch_state& launch) {
  canonical(input.executable, false); canonical(input.archive, true);
  require(input.executable.ends_with("/lightscaper") && access(input.executable.c_str(), X_OK) == 0, "Accepted application is not the installed Lightscaper executable.");
  require(input.archive.ends_with(".liscape"), "Only the owned catalog suffix may be dispatched.");
  const auto original = digest(regular(input.archive, 64 * 1024 * 1024, true)); require(original == input.sha, "Archive SHA differs from its accepted request.");
  const auto before = process(input.primary, input.executable); report["primary"] = encode_process(before, true);
  std::unique_ptr<GFile, decltype(&g_object_unref)> archive(g_file_new_for_path(input.archive.c_str()), g_object_unref);
  auto selected = resolve_default(archive.get(), input, count, report);
  report["contentType"] = quote(selected.content_type); report["mimeType"] = quote(selected.mime_type);
  report["desktopFile"] = quote(selected.desktop); report["desktopId"] = quote(selected.id); report["exec"] = quote(selected.command);
  launch.input = &input; launch.expected = selected.app.get(); launch.group = getpgrp(); launch.count = &count;
  report["callingProcessGroup"] = std::to_string(launch.group);
  gchar* uri = g_file_get_uri(archive.get()); require(uri != nullptr, "Actual file URI is unavailable.");
  GList one{uri, nullptr, nullptr}; GError* error = nullptr; ++count.launches;
  const auto accepted = g_desktop_app_info_launch_uris_as_manager(G_DESKTOP_APP_INFO(selected.app.get()), &one, nullptr,
    G_SPAWN_DO_NOT_REAP_CHILD, nullptr, nullptr, launched, &launch, &error); g_free(uri);
  try {
    if (!accepted || error) gio_error(error, "Default native desktop launcher refused the archive URI.");
    if (launch.failure) std::rethrow_exception(launch.failure);
    require(launch.children.size() == 1 && count.callbacks == 1, "One archive URI did not produce exactly one observed native secondary.");
    auto& secondary = launch.children.front(); capture_exec(secondary, input.executable, launch.group, 2000);
    require(reap(secondary, 30000), "Native secondary did not retire within its bounded deadline.");
    require(WIFEXITED(secondary.status) && WEXITSTATUS(secondary.status) == 0, "Native secondary did not naturally exit zero.");
    const auto after = process(input.primary, input.executable);
    require(after.start == before.start && after.group == before.group, "Actual primary identity changed during default dispatch.");
    report["primary"] = encode_process(after, true);
    require(digest(regular(input.archive, 64 * 1024 * 1024, true)) == original && regular(selected.desktop, 65536, false) == selected.bytes,
      "Archive or selected installed desktop changed during default dispatch.");
    auto current = resolve_default(archive.get(), input, count, report);
    require(current.desktop == selected.desktop && current.id == selected.id && current.command == selected.command,
      "Actual default route changed during native dispatch.");
  } catch (const std::exception& failure) {
    if (!cleanup(launch)) throw std::runtime_error(std::string(failure.what()) + " Cleanup could not prove native child retirement; retain the outer scope.");
    throw;
  }
}
int main(int argc, char* argv[]) {
  if (argc != 5 || std::strcmp(argv[1], "--request") || std::strcmp(argv[3], "--result")) { std::cerr << "Expected --request absolute.json --result new-absolute.json\n"; return 2; }
  fd output(-1); counters count; launch_state launch;
  object report{{"schemaVersion", "1"}, {"target", quote(target)}, {"status", quote("failed")}, {"operation", "null"}, {"nonce", "null"},
    {"sourceRevision", "null"}, {"executablePath", "null"}, {"archivePath", "null"}, {"archiveSha256", "null"}, {"primaryPid", "null"},
    {"contentType", "null"}, {"mimeType", "null"}, {"desktopFile", "null"}, {"desktopId", "null"}, {"exec", "null"}, {"primary", "null"},
    {"secondary", "null"}, {"callingProcessGroup", "null"}, {"counters", "null"}, {"error", "null"}};
  bool passed = false;
  try {
    require(getuid() == geteuid() && geteuid() != 0, "Qualification requires an ordinary native account.");
    const std::string input_path(argv[2]), output_path(argv[4]); const auto split = input_path.rfind('/');
    require(split != std::string::npos && split > 0, "Private request path must be absolute.");
    const auto parent = canonical(input_path.substr(0, split), true, true); const auto output_split = output_path.rfind('/');
    require(output_split != std::string::npos && output_path.substr(0, output_split) == parent && output_path.ends_with(".json") &&
      output_path.find('\0') == std::string::npos && output_path.size() < PATH_MAX, "Result must be a new JSON file beside its private request.");
    struct stat directory{}, metadata{}; require(lstat(parent.c_str(), &directory) == 0 && !(directory.st_mode & 0077), "Request directory must be private.");
    output.value = open(output_path.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    require(output.value >= 0, "Exclusive result destination could not be reserved.");
    require(lstat(input_path.c_str(), &metadata) == 0 && (metadata.st_mode & 0777) == 0600, "Request file must be private.");
    const auto input = read_request(regular(input_path, 16384, true));
    report["nonce"] = quote(input.nonce); report["sourceRevision"] = quote(input.revision); report["operation"] = quote("open");
    report["executablePath"] = quote(input.executable); report["archivePath"] = quote(input.archive); report["archiveSha256"] = quote(input.sha); report["primaryPid"] = std::to_string(input.primary);
    perform(input, report, count, launch); report["status"] = quote("passed"); passed = true;
  } catch (const std::exception& failure) {
    const auto* native = dynamic_cast<const native_error*>(&failure);
    report["error"] = encode({{"domain", quote(native ? native->domain : "LightscaperLinuxAssociation")}, {"code", std::to_string(native ? native->code : 1)},
      {"message", quote(std::string(failure.what()).substr(0, 2048))}});
  }
  report["counters"] = encode_counters(count);
  if (launch.children.size() == 1) report["secondary"] = encode_child(launch.children.front());
  if (output.value < 0) {
    std::cerr << encode({{"schemaVersion", "1"}, {"kind", quote("lightscaper-linux-association-no-result-refusal")},
      {"counters", encode_counters(count)}, {"error", report["error"]}}) << '\n'; return 2;
  }
  try { result(output.value, report); const auto closed = close(output.value); output.value = -1; require(closed == 0, "Exclusive result close failed."); }
  catch (const std::exception& failure) { std::cerr << failure.what() << '\n'; return 2; }
  return passed ? 0 : 1;
}
