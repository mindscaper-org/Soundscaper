/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include "files.hpp"
#include <sys/wait.h>
#include <poll.h>
#include <csignal>
#include <chrono>
#include <sstream>

namespace association {
struct process_identity {
  pid_t pid{}; pid_t group{}; std::string start; std::string executable;
};
inline std::string proc_text(const std::string& path) {
  fd input(open(path.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC)); require(input.value >= 0, "Known process identity is unavailable.");
  std::string value; char buffer[4096];
  for (;;) { auto count = read(input.value, buffer, sizeof(buffer)); if (count < 0 && errno == EINTR) continue;
    require(count >= 0 && value.size() + static_cast<std::size_t>(count) <= 16384, "Known process identity exceeds its bound.");
    if (!count) break;
    value.append(buffer, static_cast<std::size_t>(count)); }
  return value;
}
inline process_identity process(pid_t pid, const std::string& executable) {
  require(pid > 0, "Actual positive process ID required."); const auto root = "/proc/" + std::to_string(pid);
  const auto stat = proc_text(root + "/stat"); const auto split = stat.rfind(')');
  require(split != std::string::npos, "Known process stat is invalid.");
  std::istringstream fields(stat.substr(split + 2)); std::string field, start, state;
  for (unsigned index = 3; index <= 22; ++index) { require(static_cast<bool>(fields >> field), "Known process stat is truncated.");
    if (index == 3) state = field;
    if (index == 22) start = field; }
  require(state != "Z" && state != "X" && !start.empty() && start.find_first_not_of("0123456789") == std::string::npos, "Known process already retired before identity capture.");
  char target[PATH_MAX]; const auto size = readlink((root + "/exe").c_str(), target, sizeof(target));
  require(size > 0 && static_cast<std::size_t>(size) < sizeof(target) && std::string(target, static_cast<std::size_t>(size)) == executable,
    "Actual process executable differs from the accepted installed application.");
  const auto group = getpgid(pid); require(group > 0, "Known process group is unavailable.");
  struct stat metadata{}; require(::stat(root.c_str(), &metadata) == 0 && metadata.st_uid == geteuid(), "Known process belongs to another account.");
  return {pid, group, start, std::string(target, static_cast<std::size_t>(size))};
}
inline std::string encode_process(const process_identity& value, bool alive) {
  return encode({{"pid", std::to_string(value.pid)}, {"startTime", quote(value.start)}, {"executablePath", quote(value.executable)},
    {"processGroup", std::to_string(value.group)}, {"alive", alive ? "true" : "false"}});
}
struct child {
  GPid pid{}; process_identity identity{}; bool captured{}; bool waited{}; bool closed{}; int status{};
};
inline bool reap(child& value, unsigned milliseconds) {
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(milliseconds);
  while (!value.waited && std::chrono::steady_clock::now() < deadline) {
    const auto found = waitpid(value.pid, &value.status, WNOHANG);
    if (found == value.pid) value.waited = true;
    else if (found < 0 && errno != EINTR) break;
    else (void)poll(nullptr, 0, 10);
  }
  if (value.waited && !value.closed) { g_spawn_close_pid(value.pid); value.closed = true; }
  return value.waited;
}
inline std::string encode_child(const child& value) {
  object row{{"pid", std::to_string(value.pid)}, {"startTime", value.captured ? quote(value.identity.start) : "null"},
    {"executablePath", value.captured ? quote(value.identity.executable) : "null"},
    {"processGroup", value.captured ? std::to_string(value.identity.group) : "null"}, {"alive", value.waited ? "false" : "null"},
    {"waited", value.waited ? "true" : "false"}, {"exited", value.waited ? (WIFEXITED(value.status) ? "true" : "false") : "null"},
    {"exitCode", value.waited && WIFEXITED(value.status) ? std::to_string(WEXITSTATUS(value.status)) : "null"},
    {"signal", value.waited && WIFSIGNALED(value.status) ? std::to_string(WTERMSIG(value.status)) : "null"}, {"pidClosed", value.closed ? "true" : "false"}};
  return encode(row);
}
} // namespace association
