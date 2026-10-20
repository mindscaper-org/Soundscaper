/* SPDX-License-Identifier: AGPL-3.0-only */
// Build-only qualification peer. Never copied into a shipping role inventory.
#include <array>
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
#include <cerrno>
#include <fcntl.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <sys/wait.h>
#include <unistd.h>
#endif
int main() {
#ifdef LIGHTSCAPER_PHOTO_LINUX_BOOTSTRAP
 if (!lightscaper_photo_linux_bootstrap()) return 125;
#endif
#ifdef LIGHTSCAPER_PHOTO_MACOS_BOOTSTRAP
 if (!lightscaper::photo::macosBootstrap::lightscaperPhotoMacosBootstrap()) return 125;
#endif
#ifdef _WIN32
 if (_setmode(_fileno(stdin), _O_BINARY) == -1 || _setmode(_fileno(stdout), _O_BINARY) == -1) return 2;
#endif
 std::array<unsigned char, 6> header{}; if (std::fread(header.data(), 1, header.size(), stdin) != header.size()) return 2;
 const auto length = static_cast<std::uint32_t>(header[0]) | (static_cast<std::uint32_t>(header[1]) << 8)
  | (static_cast<std::uint32_t>(header[2]) << 16) | (static_cast<std::uint32_t>(header[3]) << 24);
 if (length == 0 || length > 65536) return 2;
 std::string path(length, '\0'); if (std::fread(path.data(), 1, path.size(), stdin) != path.size()) return 2;
 bool fileDenied = false, networkDenied = false, childDenied = false;
#ifdef _WIN32
 if (length % 2) return 2;
 std::wstring native; native.reserve(length / 2);
 for (size_t i = 0; i < path.size(); i += 2) native.push_back(static_cast<wchar_t>(static_cast<unsigned char>(path[i]) | (static_cast<unsigned char>(path[i + 1]) << 8)));
 const HANDLE file = CreateFileW(native.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
 fileDenied = file == INVALID_HANDLE_VALUE && GetLastError() == ERROR_ACCESS_DENIED; if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
 WSADATA data{}; if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return 2;
 const SOCKET connection = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
 if (connection == INVALID_SOCKET) networkDenied = WSAGetLastError() == WSAEACCES;
#else
 const int file = open(path.c_str(), O_RDONLY | O_CLOEXEC); fileDenied = file < 0 && (errno == EACCES || errno == EPERM); if (file >= 0) close(file);
 const int connection = socket(AF_INET, SOCK_STREAM, 0); if (connection < 0) networkDenied = errno == EACCES || errno == EPERM;
#endif
 if (!networkDenied) {
  sockaddr_in address{}; address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(0x7f000001U); address.sin_port = htons(static_cast<unsigned short>((header[4] << 8) | header[5]));
  const int result = connect(connection, reinterpret_cast<const sockaddr*>(&address), sizeof(address));
#ifdef _WIN32
  networkDenied = result != 0 && WSAGetLastError() == WSAEACCES;
#else
  networkDenied = result != 0 && (errno == EACCES || errno == EPERM);
#endif
 }
#ifdef _WIN32
 if (connection != INVALID_SOCKET) closesocket(connection); WSACleanup();
 std::array<wchar_t, 32768> executable{}; const auto count = GetModuleFileNameW(nullptr, executable.data(), static_cast<DWORD>(executable.size()));
 if (count == 0 || count >= executable.size()) return 2;
 STARTUPINFOW startup{}; startup.cb = sizeof(startup); PROCESS_INFORMATION child{};
 std::wstring command = L"\"" + std::wstring(executable.data()) + L"\"";
 const bool created = CreateProcessW(executable.data(), command.data(), nullptr, nullptr, FALSE, CREATE_SUSPENDED, nullptr, nullptr, &startup, &child) != FALSE;
 const DWORD refusal = created ? ERROR_SUCCESS : GetLastError(); childDenied = !created && (refusal == ERROR_ACCESS_DENIED || refusal == ERROR_NOT_ENOUGH_QUOTA);
 if (created) { TerminateProcess(child.hProcess, 2); WaitForSingleObject(child.hProcess, INFINITE); CloseHandle(child.hThread); CloseHandle(child.hProcess); }
#else
 if (connection >= 0) close(connection);
 const pid_t child = fork(); childDenied = child < 0 && (errno == EACCES || errno == EPERM);
 if (child == 0) _exit(2);
 if (child > 0) { int status = 0; while (waitpid(child, &status, 0) < 0 && errno == EINTR) {} }
#endif
 if (!fileDenied || !networkDenied || !childDenied) return 2;
 constexpr char passed[] = "PHOTO_ISOLATION_CANARY_V1 PASS\n";
 return std::fwrite(passed, 1, sizeof(passed) - 1, stdout) == sizeof(passed) - 1 && std::fflush(stdout) == 0 ? 0 : 2;
}
