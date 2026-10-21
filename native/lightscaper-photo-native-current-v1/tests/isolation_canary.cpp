/* SPDX-License-Identifier: AGPL-3.0-only */
// Build-only qualification peer. Never copied into a shipping role inventory.
#include <array>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <string>
#ifdef LIGHTSCAPER_PHOTO_LINUX_BOOTSTRAP
extern "C" int lightscaper_photo_linux_bootstrap(void);
#endif
#ifdef LIGHTSCAPER_PHOTO_MACOS_BOOTSTRAP
#include "photo_macos_bootstrap.hpp"
#endif
#ifdef _WIN32
#include <winsock2.h>
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#else
#include <fcntl.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <sys/wait.h>
#include <unistd.h>
#endif
namespace {
int failed(const char* stage, unsigned long code) {
 std::fprintf(stderr, "PHOTO_ISOLATION_CANARY_V1 FAIL stage=%s code=%lu\n", stage, code);
 std::fflush(stderr); return 2;
}
}
int main() {
#ifdef LIGHTSCAPER_PHOTO_LINUX_BOOTSTRAP
 if (!lightscaper_photo_linux_bootstrap()) return 125;
#endif
#ifdef LIGHTSCAPER_PHOTO_MACOS_BOOTSTRAP
 if (!lightscaper::photo::macosBootstrap::lightscaperPhotoMacosBootstrap()) return 125;
#endif
#ifdef _WIN32
 if (_setmode(_fileno(stdin), _O_BINARY) == -1 || _setmode(_fileno(stdout), _O_BINARY) == -1) return failed("binary-stdio", static_cast<unsigned long>(errno));
#endif
 std::array<unsigned char, 6> header{}; if (std::fread(header.data(), 1, header.size(), stdin) != header.size()) return failed("header-read", static_cast<unsigned long>(errno));
 const auto length = static_cast<std::uint32_t>(header[0]) | (static_cast<std::uint32_t>(header[1]) << 8)
  | (static_cast<std::uint32_t>(header[2]) << 16) | (static_cast<std::uint32_t>(header[3]) << 24);
 if (length == 0 || length > 65536) return failed("path-length", EINVAL);
 std::string path(length, '\0'); if (std::fread(path.data(), 1, path.size(), stdin) != path.size()) return failed("path-read", static_cast<unsigned long>(errno));
 bool fileDenied = false, networkDenied = false, childDenied = false;
 unsigned long fileError = 0, socketError = 0, networkError = 0, childError = 0;
#ifdef _WIN32
 if (length % 2) return failed("utf16-length", ERROR_INVALID_DATA);
 std::wstring native; native.reserve(length / 2);
 for (size_t i = 0; i < path.size(); i += 2) native.push_back(static_cast<wchar_t>(static_cast<unsigned char>(path[i]) | (static_cast<unsigned char>(path[i + 1]) << 8)));
 const HANDLE file = CreateFileW(native.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
 fileError = file == INVALID_HANDLE_VALUE ? GetLastError() : ERROR_SUCCESS;
 fileDenied = file == INVALID_HANDLE_VALUE && fileError == ERROR_ACCESS_DENIED; if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
 WSADATA data{}; const int startupStatus = WSAStartup(MAKEWORD(2, 2), &data);
 if (startupStatus != 0) return failed("winsock-startup", static_cast<unsigned long>(startupStatus));
 const SOCKET connection = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
 socketError = connection == INVALID_SOCKET ? static_cast<unsigned long>(WSAGetLastError()) : 0; networkError = socketError;
 if (connection == INVALID_SOCKET) networkDenied = networkError == WSAEACCES;
#else
 const int file = open(path.c_str(), O_RDONLY | O_CLOEXEC); fileError = file < 0 ? static_cast<unsigned long>(errno) : 0;
 fileDenied = file < 0 && (fileError == EACCES || fileError == EPERM); if (file >= 0) close(file);
 const int connection = socket(AF_INET, SOCK_STREAM, 0); socketError = connection < 0 ? static_cast<unsigned long>(errno) : 0; networkError = socketError;
 if (connection < 0) networkDenied = networkError == EACCES || networkError == EPERM;
#endif
 if (!networkDenied) {
  sockaddr_in address{}; address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(0x7f000001U); address.sin_port = htons(static_cast<unsigned short>((header[4] << 8) | header[5]));
  const int result = connect(connection, reinterpret_cast<const sockaddr*>(&address), sizeof(address));
#ifdef _WIN32
  networkError = result != 0 ? static_cast<unsigned long>(WSAGetLastError()) : 0;
  networkDenied = result != 0 && networkError == WSAEACCES;
#else
  networkError = result != 0 ? static_cast<unsigned long>(errno) : 0;
  networkDenied = result != 0 && (networkError == EACCES || networkError == EPERM);
#endif
 }
#ifdef _WIN32
 if (connection != INVALID_SOCKET) closesocket(connection); WSACleanup();
 std::array<wchar_t, 32768> executable{}; const auto count = GetModuleFileNameW(nullptr, executable.data(), static_cast<DWORD>(executable.size()));
 if (count == 0 || count >= executable.size()) return failed("module-path", count == 0 ? GetLastError() : ERROR_INSUFFICIENT_BUFFER);
 STARTUPINFOW startup{}; startup.cb = sizeof(startup); PROCESS_INFORMATION child{};
 std::wstring command = L"\"" + std::wstring(executable.data()) + L"\"";
 const bool created = CreateProcessW(executable.data(), command.data(), nullptr, nullptr, FALSE, CREATE_SUSPENDED, nullptr, nullptr, &startup, &child) != FALSE;
 const DWORD refusal = created ? ERROR_SUCCESS : GetLastError(); childError = refusal; childDenied = !created && (refusal == ERROR_ACCESS_DENIED || refusal == ERROR_NOT_ENOUGH_QUOTA);
 if (created) { TerminateProcess(child.hProcess, 2); WaitForSingleObject(child.hProcess, INFINITE); CloseHandle(child.hThread); CloseHandle(child.hProcess); }
#else
 if (connection >= 0) close(connection);
 const pid_t child = fork(); childError = child < 0 ? static_cast<unsigned long>(errno) : 0;
 childDenied = child < 0 && (childError == EACCES || childError == EPERM);
 if (child == 0) _exit(2);
 if (child > 0) { int status = 0; while (waitpid(child, &status, 0) < 0 && errno == EINTR) {} }
#endif
 if (!fileDenied || !networkDenied || !childDenied) {
  std::fprintf(stderr, "PHOTO_ISOLATION_CANARY_V1 FAIL stage=denials fileDenied=%u fileError=%lu networkDenied=%u socketError=%lu networkError=%lu childDenied=%u childError=%lu\n",
   fileDenied ? 1U : 0U, fileError, networkDenied ? 1U : 0U, socketError, networkError, childDenied ? 1U : 0U, childError);
  std::fflush(stderr); return 2;
 }
 constexpr char passed[] = "PHOTO_ISOLATION_CANARY_V1 PASS\n";
 if (std::fwrite(passed, 1, sizeof(passed) - 1, stdout) != sizeof(passed) - 1) return failed("stdout-write", static_cast<unsigned long>(errno));
 return std::fflush(stdout) == 0 ? 0 : failed("stdout-flush", static_cast<unsigned long>(errno));
}
