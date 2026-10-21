/* SPDX-License-Identifier: AGPL-3.0-only */
// Build-only qualification peer. Never copied into a shipping role inventory.
#include <array>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstring>
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
#include <netfw.h>
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
#ifdef _WIN32
int windowsNetworkPolicy(unsigned long& policyType) {
 HANDLE token = nullptr; HMODULE module = nullptr; PSID_AND_ATTRIBUTES exemptions = nullptr; DWORD count = 0;
 auto finish = [&](const char* stage, DWORD code) {
  DWORD cleanup = ERROR_SUCCESS;
  if (exemptions) {
   for (DWORD index = 0; index < count; ++index) if (exemptions[index].Sid && !HeapFree(GetProcessHeap(), 0, exemptions[index].Sid) && cleanup == ERROR_SUCCESS) cleanup = GetLastError() == ERROR_SUCCESS ? ERROR_INVALID_DATA : GetLastError();
   if (!HeapFree(GetProcessHeap(), 0, exemptions) && cleanup == ERROR_SUCCESS) cleanup = GetLastError() == ERROR_SUCCESS ? ERROR_INVALID_DATA : GetLastError();
  }
  if (token && !CloseHandle(token) && cleanup == ERROR_SUCCESS) cleanup = GetLastError() == ERROR_SUCCESS ? ERROR_INVALID_DATA : GetLastError();
  if (module && !FreeLibrary(module) && cleanup == ERROR_SUCCESS) cleanup = GetLastError() == ERROR_SUCCESS ? ERROR_INVALID_DATA : GetLastError();
  if (stage) return failed(stage, code);
  return cleanup == ERROR_SUCCESS ? 0 : failed("network-policy-cleanup", cleanup);
 };
 if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return finish("network-token-open", GetLastError());
 DWORD value = 0, size = 0;
 if (!GetTokenInformation(token, TokenIsAppContainer, &value, sizeof(value), &size)) return finish("network-token-app-api", GetLastError());
 if (size != sizeof(value) || value != 1) return finish("network-token-app", value);
 value = 0; size = 0;
 if (!GetTokenInformation(token, TokenIsLessPrivilegedAppContainer, &value, sizeof(value), &size)) return finish("network-token-lpac-api", GetLastError());
 if (size != sizeof(value) || value != 1) return finish("network-token-lpac", value);
 alignas(TOKEN_GROUPS) std::array<unsigned char, 65536> groups{};
 if (!GetTokenInformation(token, TokenCapabilities, groups.data(), static_cast<DWORD>(groups.size()), &size)) return finish("network-token-cap-api", GetLastError());
 if (size < sizeof(DWORD) || size > groups.size()) return finish("network-token-cap-size", size);
 const auto* capabilities = reinterpret_cast<const TOKEN_GROUPS*>(groups.data());
 if (capabilities->GroupCount != 0) return finish("network-token-capabilities", capabilities->GroupCount);
 alignas(TOKEN_APPCONTAINER_INFORMATION) std::array<unsigned char, 4096> info{};
 if (!GetTokenInformation(token, TokenAppContainerSid, info.data(), static_cast<DWORD>(info.size()), &size)) return finish("network-token-sid-api", GetLastError());
 if (size < sizeof(TOKEN_APPCONTAINER_INFORMATION) || size > info.size()) return finish("network-token-sid-size", size);
 const PSID sid = reinterpret_cast<const TOKEN_APPCONTAINER_INFORMATION*>(info.data())->TokenAppContainer;
 const auto begin = reinterpret_cast<std::uintptr_t>(info.data()), address = reinterpret_cast<std::uintptr_t>(sid);
 if (!sid || address < begin || address > begin + size - 8 || !IsValidSid(sid) || GetLengthSid(sid) > begin + size - address) return finish("network-token-sid", ERROR_INVALID_SID);
 module = LoadLibraryExW(L"FirewallAPI.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
 if (!module) return finish("network-policy-library", GetLastError());
 const auto configuration = reinterpret_cast<decltype(&NetworkIsolationGetAppContainerConfig)>(GetProcAddress(module, "NetworkIsolationGetAppContainerConfig"));
 const auto diagnose = reinterpret_cast<decltype(&NetworkIsolationDiagnoseConnectFailureAndGetInfo)>(GetProcAddress(module, "NetworkIsolationDiagnoseConnectFailureAndGetInfo"));
 if (!configuration || !diagnose) return finish("network-policy-procedure", ERROR_PROC_NOT_FOUND);
 DWORD status = configuration(&count, &exemptions);
 if (status != ERROR_SUCCESS) { exemptions = nullptr; return finish("network-policy-config", status); }
 // OS-owned output is bounded before enumeration; any excess is a failed probe.
 if (count > 4096 || (count != 0 && !exemptions)) {
  // Do not walk an unbounded array. The failing private process retires all memory.
  exemptions = nullptr; return finish("network-policy-config-size", count);
 }
 for (DWORD index = 0; index < count; ++index) {
  if (!exemptions[index].Sid || !IsValidSid(exemptions[index].Sid)) return finish("network-policy-config-sid", ERROR_INVALID_SID);
  if (EqualSid(sid, exemptions[index].Sid)) return finish("network-policy-loopback-exempt", ERROR_ACCESS_DENIED);
 }
 NETISO_ERROR_TYPE type = NETISO_ERROR_TYPE_NONE;
 // Classification only: no socket or request is sent to this documentation IP.
 status = diagnose(L"192.0.2.1", &type);
 if (status != ERROR_SUCCESS) return finish("network-policy-diagnose", status);
 if (type != NETISO_ERROR_TYPE_PRIVATE_NETWORK && type != NETISO_ERROR_TYPE_INTERNET_CLIENT && type != NETISO_ERROR_TYPE_INTERNET_CLIENT_SERVER) return finish("network-policy-type", static_cast<DWORD>(type));
 policyType = static_cast<unsigned long>(type); return finish(nullptr, ERROR_SUCCESS);
}
int windowsNetworkControl(const char* portText) {
 HANDLE token = nullptr; DWORD app = 1, size = 0;
 if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return failed("network-control-token-open", GetLastError());
 const BOOL queried = GetTokenInformation(token, TokenIsAppContainer, &app, sizeof(app), &size); const DWORD queryError = queried ? ERROR_SUCCESS : GetLastError();
 if (!CloseHandle(token)) return failed("network-control-token-close", GetLastError());
 if (!queried) return failed("network-control-token-api", queryError);
 if (size != sizeof(app) || app != 0) return failed("network-control-contained", app);
 unsigned int port = 0; size_t digits = 0;
 for (const char* next = portText; *next; ++next) {
  if (*next < '0' || *next > '9' || ++digits > 5) return failed("network-control-port", ERROR_INVALID_PARAMETER);
  port = port * 10 + static_cast<unsigned int>(*next - '0');
 }
 if (!digits || port == 0 || port > 65535) return failed("network-control-port", ERROR_INVALID_PARAMETER);
 WSADATA data{}; const int startup = WSAStartup(MAKEWORD(2, 2), &data);
 if (startup != 0) return failed("winsock-startup", static_cast<unsigned long>(startup));
 const SOCKET connection = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
 int result = SOCKET_ERROR; unsigned long error = connection == INVALID_SOCKET ? static_cast<unsigned long>(WSAGetLastError()) : 0;
 if (connection != INVALID_SOCKET) {
  sockaddr_in address{}; address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(0x7f000001U); address.sin_port = htons(static_cast<unsigned short>(port));
  u_long nonblocking = 1;
  if (ioctlsocket(connection, FIONBIO, &nonblocking) == 0) {
   result = connect(connection, reinterpret_cast<const sockaddr*>(&address), sizeof(address)); error = result == 0 ? 0 : static_cast<unsigned long>(WSAGetLastError());
   if (result != 0 && error == WSAEWOULDBLOCK) {
    fd_set writable{}, refused{}; FD_ZERO(&writable); FD_ZERO(&refused); FD_SET(connection, &writable); FD_SET(connection, &refused); timeval timeout{2, 0};
    const int ready = select(0, nullptr, &writable, &refused, &timeout);
    if (ready > 0) {
     int status = 0, bytes = sizeof(status);
     if (getsockopt(connection, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&status), &bytes) == 0 && bytes == sizeof(status)) { error = static_cast<unsigned long>(status); result = status == 0 && FD_ISSET(connection, &writable) ? 0 : SOCKET_ERROR; }
     else error = static_cast<unsigned long>(WSAGetLastError());
    } else error = ready == 0 ? WSAETIMEDOUT : static_cast<unsigned long>(WSAGetLastError());
   }
   if (result == 0) {
    sockaddr_in peer{}; int bytes = sizeof(peer);
    if (getpeername(connection, reinterpret_cast<sockaddr*>(&peer), &bytes) != 0) { result = SOCKET_ERROR; error = static_cast<unsigned long>(WSAGetLastError()); }
    else if (bytes != sizeof(peer) || peer.sin_family != AF_INET || peer.sin_addr.s_addr != address.sin_addr.s_addr || peer.sin_port != address.sin_port) { result = SOCKET_ERROR; error = WSAEINVAL; }
   }
  } else error = static_cast<unsigned long>(WSAGetLastError());
 }
 const int closed = connection == INVALID_SOCKET ? 0 : closesocket(connection); const int closeError = closed == 0 ? 0 : WSAGetLastError();
 const int cleaned = WSACleanup(); const int cleanupError = cleaned == 0 ? 0 : WSAGetLastError();
 if (result != 0) return failed("network-control-connect", error);
 if (closed != 0) return failed("network-control-socket-close", static_cast<unsigned long>(closeError));
 if (cleaned != 0) return failed("network-control-winsock-close", static_cast<unsigned long>(cleanupError));
 constexpr char passed[] = "PHOTO_ISOLATION_CANARY_V2 NETWORK_CONTROL_PASS\n";
 if (std::fwrite(passed, 1, sizeof(passed) - 1, stdout) != sizeof(passed) - 1) return failed("stdout-write", static_cast<unsigned long>(errno));
 return std::fflush(stdout) == 0 ? 0 : failed("stdout-flush", static_cast<unsigned long>(errno));
}
#endif
}
int main(int argc, char** argv) {
 static_cast<void>(argv);
#ifdef LIGHTSCAPER_PHOTO_LINUX_BOOTSTRAP
 if (!lightscaper_photo_linux_bootstrap()) return 125;
#endif
#ifdef LIGHTSCAPER_PHOTO_MACOS_BOOTSTRAP
 if (!lightscaper::photo::macosBootstrap::lightscaperPhotoMacosBootstrap()) return 125;
#endif
#ifdef _WIN32
 if (_setmode(_fileno(stdin), _O_BINARY) == -1 || _setmode(_fileno(stdout), _O_BINARY) == -1) return failed("binary-stdio", static_cast<unsigned long>(errno));
 if (argc == 3 && std::strcmp(argv[1], "--network-positive-control") == 0) return windowsNetworkControl(argv[2]);
 if (argc == 2 && std::strcmp(argv[1], "--network-policy-control") == 0) { unsigned long type = 0; return windowsNetworkPolicy(type); }
#endif
 if (argc != 1) return failed("arguments", EINVAL);
 std::array<unsigned char, 6> header{}; if (std::fread(header.data(), 1, header.size(), stdin) != header.size()) return failed("header-read", static_cast<unsigned long>(errno));
 const auto length = static_cast<std::uint32_t>(header[0]) | (static_cast<std::uint32_t>(header[1]) << 8) | (static_cast<std::uint32_t>(header[2]) << 16) | (static_cast<std::uint32_t>(header[3]) << 24);
 if (length == 0 || length > 65536) return failed("path-length", EINVAL);
 std::string path(length, '\0'); if (std::fread(path.data(), 1, path.size(), stdin) != path.size()) return failed("path-read", static_cast<unsigned long>(errno));
 bool fileDenied = false, childDenied = false;
 unsigned long fileError = 0, childError = 0;
#ifdef _WIN32
 if (length % 2) return failed("utf16-length", ERROR_INVALID_DATA);
 std::wstring native; native.reserve(length / 2);
 for (size_t i = 0; i < path.size(); i += 2) native.push_back(static_cast<wchar_t>(static_cast<unsigned char>(path[i]) | (static_cast<unsigned char>(path[i + 1]) << 8)));
 const HANDLE file = CreateFileW(native.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
 fileError = file == INVALID_HANDLE_VALUE ? GetLastError() : ERROR_SUCCESS; fileDenied = file == INVALID_HANDLE_VALUE && fileError == ERROR_ACCESS_DENIED;
 if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
 if (!fileDenied) return failed("file-denial", fileError);
 unsigned long policyType = 0; if (const int result = windowsNetworkPolicy(policyType); result != 0) return result;
 std::array<wchar_t, 32768> executable{}; const auto count = GetModuleFileNameW(nullptr, executable.data(), static_cast<DWORD>(executable.size()));
 if (count == 0 || count >= executable.size()) return failed("module-path", count == 0 ? GetLastError() : ERROR_INSUFFICIENT_BUFFER);
 STARTUPINFOW startup{}; startup.cb = sizeof(startup); PROCESS_INFORMATION child{}; std::wstring command = L"\"" + std::wstring(executable.data()) + L"\"";
 const bool created = CreateProcessW(executable.data(), command.data(), nullptr, nullptr, FALSE, CREATE_SUSPENDED, nullptr, nullptr, &startup, &child) != FALSE;
 childError = created ? ERROR_SUCCESS : GetLastError(); childDenied = !created && (childError == ERROR_ACCESS_DENIED || childError == ERROR_NOT_ENOUGH_QUOTA);
 if (created) { TerminateProcess(child.hProcess, 2); WaitForSingleObject(child.hProcess, INFINITE); CloseHandle(child.hThread); CloseHandle(child.hProcess); }
 if (!childDenied) return failed("child-denial", childError);
 if (std::fprintf(stdout, "PHOTO_ISOLATION_CANARY_V2 POLICY_PASS type=%lu\n", policyType) < 0) return failed("stdout-write", static_cast<unsigned long>(errno));
#else
 bool networkDenied = false; unsigned long socketError = 0, networkError = 0;
 const int file = open(path.c_str(), O_RDONLY | O_CLOEXEC); fileError = file < 0 ? static_cast<unsigned long>(errno) : 0; fileDenied = file < 0 && (fileError == EACCES || fileError == EPERM); if (file >= 0) close(file);
 const int connection = socket(AF_INET, SOCK_STREAM, 0); socketError = connection < 0 ? static_cast<unsigned long>(errno) : 0; networkError = socketError;
 if (connection < 0) networkDenied = networkError == EACCES || networkError == EPERM;
 if (!networkDenied) {
  sockaddr_in address{}; address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(0x7f000001U); address.sin_port = htons(static_cast<unsigned short>((header[4] << 8) | header[5]));
  const int result = connect(connection, reinterpret_cast<const sockaddr*>(&address), sizeof(address)); networkError = result != 0 ? static_cast<unsigned long>(errno) : 0; networkDenied = result != 0 && (networkError == EACCES || networkError == EPERM);
 }
 if (connection >= 0) close(connection);
 const pid_t child = fork(); childError = child < 0 ? static_cast<unsigned long>(errno) : 0; childDenied = child < 0 && (childError == EACCES || childError == EPERM);
 if (child == 0) _exit(2);
 if (child > 0) { int status = 0; while (waitpid(child, &status, 0) < 0 && errno == EINTR) {} }
 if (!fileDenied || !networkDenied || !childDenied) {
  std::fprintf(stderr, "PHOTO_ISOLATION_CANARY_V1 FAIL stage=denials fileDenied=%u fileError=%lu networkDenied=%u socketError=%lu networkError=%lu childDenied=%u childError=%lu\n", fileDenied ? 1U : 0U, fileError, networkDenied ? 1U : 0U, socketError, networkError, childDenied ? 1U : 0U, childError);
  std::fflush(stderr); return 2;
 }
 constexpr char passed[] = "PHOTO_ISOLATION_CANARY_V1 PASS\n";
 if (std::fwrite(passed, 1, sizeof(passed) - 1, stdout) != sizeof(passed) - 1) return failed("stdout-write", static_cast<unsigned long>(errno));
#endif
 return std::fflush(stdout) == 0 ? 0 : failed("stdout-flush", static_cast<unsigned long>(errno));
}
