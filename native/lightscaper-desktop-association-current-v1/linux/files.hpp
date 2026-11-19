/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include <gio/gio.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <climits>
#include <cctype>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace association {
inline void require(bool condition, const std::string& message) { if (!condition) throw std::runtime_error(message); }
struct fd {
  int value{-1};
  explicit fd(int input) : value(input) {}
  fd(const fd&) = delete; fd& operator=(const fd&) = delete;
  ~fd() { if (value >= 0) close(value); }
};
inline bool hex(const std::string& value, std::size_t length) {
  return value.size() == length && value.find_first_not_of("0123456789abcdef") == std::string::npos;
}
inline std::string canonical(const std::string& path, bool own, bool directory = false) {
  require(path.size() > 1 && path.size() < PATH_MAX && path.front() == '/' && path.find('\0') == std::string::npos &&
    g_utf8_validate(path.c_str(), static_cast<gssize>(path.size()), nullptr), "Path must be absolute UTF-8.");
  char resolved[PATH_MAX]; require(realpath(path.c_str(), resolved) && path == resolved, "Symlink or noncanonical path refused.");
  std::string cursor; struct stat metadata{};
  for (std::size_t end = 1; end <= path.size(); ++end) if (end == path.size() || path[end] == '/') {
    cursor = path.substr(0, end); require(lstat(cursor.c_str(), &metadata) == 0 && !S_ISLNK(metadata.st_mode), "Symlink component refused.");
  }
  require(directory ? S_ISDIR(metadata.st_mode) : S_ISREG(metadata.st_mode), "Physical path kind differs.");
  require((own ? metadata.st_uid == geteuid() : metadata.st_uid == geteuid() || metadata.st_uid == 0) && !(metadata.st_mode & 0022),
    "Input is not an owned or trusted installed non-writable path.");
  return path;
}
inline bool stamp(const struct stat& a, const struct stat& b) {
  return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_size == b.st_size && a.st_mode == b.st_mode &&
    a.st_mtim.tv_sec == b.st_mtim.tv_sec && a.st_mtim.tv_nsec == b.st_mtim.tv_nsec &&
    a.st_ctim.tv_sec == b.st_ctim.tv_sec && a.st_ctim.tv_nsec == b.st_ctim.tv_nsec;
}
inline std::string regular(const std::string& path, std::size_t maximum, bool own) {
  canonical(path, own); fd input(open(path.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC)); require(input.value >= 0, "Physical read open failed.");
  struct stat before{}, after{}, at_path{};
  require(fstat(input.value, &before) == 0 && before.st_size > 0 && static_cast<std::uint64_t>(before.st_size) <= maximum &&
    before.st_nlink == 1 && S_ISREG(before.st_mode), "Physical input exceeds its closed size/link bound.");
  std::string value(static_cast<std::size_t>(before.st_size), '\0'); std::size_t offset = 0;
  while (offset < value.size()) {
    const auto count = read(input.value, value.data() + offset, value.size() - offset); if (count < 0 && errno == EINTR) continue;
    require(count > 0, "Physical read did not complete."); offset += static_cast<std::size_t>(count);
  }
  char extra{}; ssize_t count; do { count = read(input.value, &extra, 1); } while (count < 0 && errno == EINTR);
  require(count == 0 && fstat(input.value, &after) == 0 && lstat(path.c_str(), &at_path) == 0 &&
    stamp(before, after) && stamp(before, at_path) && !S_ISLNK(at_path.st_mode), "Physical input changed while read.");
  return value;
}
inline std::string digest(const std::string& bytes) {
  gchar* value = g_compute_checksum_for_data(G_CHECKSUM_SHA256, reinterpret_cast<const guchar*>(bytes.data()), bytes.size());
  require(value != nullptr, "SHA-256 unavailable."); std::string result(value); g_free(value); return result;
}
inline std::string quote(std::string_view input) {
  std::string value = "\""; const char* digits = "0123456789abcdef";
  for (unsigned char c : input) {
    if (c == '\\' || c == '"') { value += '\\'; value += static_cast<char>(c); }
    else if (c < 32) { value += "\\u00"; value += digits[c >> 4]; value += digits[c & 15]; }
    else value += static_cast<char>(c);
  }
  return value + '"';
}
using object = std::map<std::string, std::string>;
inline std::string encode(const object& row) {
  std::string bytes = "{"; bool first = true;
  for (const auto& [key, value] : row) { if (!first) bytes += ','; first = false; bytes += quote(key) + ':' + value; }
  return bytes + '}';
}
inline std::string compact(std::string_view bytes) {
  std::string value; bool quoted = false, escaped = false;
  for (const char c : bytes) {
    if (!quoted && (c == ' ' || c == '\t' || c == '\r' || c == '\n')) continue;
    value += c;
    if (escaped) escaped = false;
    else if (quoted && c == '\\') escaped = true;
    else if (c == '"') quoted = !quoted;
  }
  return value;
}
inline void result(int descriptor, const object& row) {
  const auto bytes = encode(row); require(bytes.size() < 16384, "Result exceeds its bound."); std::size_t offset = 0;
  while (offset < bytes.size()) { const auto count = write(descriptor, bytes.data() + offset, bytes.size() - offset);
    if (count < 0 && errno == EINTR) continue;
    require(count > 0, "Result write failed."); offset += static_cast<std::size_t>(count); }
  require(fsync(descriptor) == 0, "Result sync failed.");
}
} // namespace association
