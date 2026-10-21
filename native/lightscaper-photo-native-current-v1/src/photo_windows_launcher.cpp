/* SPDX-License-Identifier: AGPL-3.0-only */

#include <windows.h>
#include <aclapi.h>
#include <userenv.h>
#include <io.h>

#include <algorithm>
#include <array>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <string>
#include <utility>
#include <vector>

namespace {
constexpr char enforcementFrame[] = "M5_NATIVE_ISOLATION_ENFORCED_V1\n";
constexpr size_t maximumGrants = 64u;
enum class Access { readOnly, readExecute, writeOnly };
struct Grant { HANDLE handle; Access access; };
struct Values {
	HANDLE enforcement = nullptr, profile = nullptr, broker = nullptr, executable = nullptr, control = nullptr;
	int enforcementFd = -1;
	HANDLE extraInput = nullptr;
	std::vector<Grant> grants;
	std::wstring authorityProfile;
	SIZE_T rss = 0u; uint64_t durationMs = 0u;
};

HANDLE photoSupervisedProcess = nullptr;
void joinPhotoSupervised(bool terminate) {
 if (photoSupervisedProcess == nullptr) return;
 if (terminate) (void)TerminateProcess(photoSupervisedProcess, 125u);
 if (WaitForSingleObject(photoSupervisedProcess, INFINITE) != WAIT_OBJECT_0) ExitProcess(125u);
}
[[noreturn]] void nativeFailure(const char *stage, DWORD code)
{
	std::array<char, 160> message{};
	const int length = std::snprintf(message.data(), message.size(),
		"M5_NATIVE_ISOLATION_FAILURE_V1 windows %s %lu\n", stage, static_cast<unsigned long>(code));
	const HANDLE error = GetStdHandle(STD_ERROR_HANDLE);
	DWORD written = 0u;
	if (length > 0 && static_cast<size_t>(length) < message.size()
		&& error != nullptr && error != INVALID_HANDLE_VALUE) {
		(void)WriteFile(error, message.data(), static_cast<DWORD>(length), &written, nullptr);
	}
	joinPhotoSupervised(true); ExitProcess(125u);
}

bool exactFd(const std::wstring &value, const wchar_t *prefix, HANDLE &output,
	int *descriptor = nullptr)
{
	const size_t length = std::wcslen(prefix);
	if (value.rfind(prefix, 0u) != 0u) return false;
	if (output != nullptr) nativeFailure("duplicate-descriptor", ERROR_INVALID_PARAMETER);
	wchar_t *end = nullptr; const auto raw = std::wcstoull(value.c_str() + length, &end, 10);
	if (end == nullptr || *end != L'\0' || raw < 3u || raw > 4095u) nativeFailure("descriptor-number", ERROR_INVALID_PARAMETER);
	const intptr_t handle = _get_osfhandle(static_cast<int>(raw));
	if (handle == -1) nativeFailure("descriptor-handle", ERROR_INVALID_HANDLE);
	if (descriptor != nullptr) {
		if (*descriptor >= 0) nativeFailure("duplicate-enforcement-descriptor", ERROR_INVALID_PARAMETER);
		*descriptor = static_cast<int>(raw);
	}
	output = reinterpret_cast<HANDLE>(handle); return true;
}

bool exactNumber(const std::wstring &value, const wchar_t *prefix, uint64_t &slot)
{
	const size_t length = std::wcslen(prefix);
	if (value.rfind(prefix, 0u) != 0u) return false;
	if (slot != 0u) nativeFailure("duplicate-limit", ERROR_INVALID_PARAMETER);
	wchar_t *end = nullptr; const auto parsed = std::wcstoull(value.c_str() + length, &end, 10);
	if (end == nullptr || *end != L'\0' || parsed == 0u) nativeFailure("limit-number", ERROR_INVALID_PARAMETER);
	slot = parsed; return true;
}

std::wstring finalPath(HANDLE handle)
{
	std::array<wchar_t, 32768> path{};
	const DWORD length = GetFinalPathNameByHandleW(handle, path.data(), static_cast<DWORD>(path.size()),
		FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
	if (length == 0u) nativeFailure("grant-final-path", GetLastError());
	if (length >= path.size()) nativeFailure("grant-final-path-size", ERROR_INSUFFICIENT_BUFFER);
	return path.data();
}

bool sameFile(HANDLE left, HANDLE right)
{
	FILE_ID_INFO a{}, b{};
	return GetFileInformationByHandleEx(left, FileIdInfo, &a, sizeof(a))
		&& GetFileInformationByHandleEx(right, FileIdInfo, &b, sizeof(b))
		&& a.VolumeSerialNumber == b.VolumeSerialNumber
		&& std::memcmp(a.FileId.Identifier, b.FileId.Identifier, sizeof(a.FileId.Identifier)) == 0;
}

bool authorityProfile(const std::wstring &value, std::wstring &output)
{
	constexpr wchar_t prefix[] = L"--authority-profile=";
	if (value.rfind(prefix, 0u) != 0u) return false;
	if (!output.empty()) nativeFailure("duplicate-authority-profile", ERROR_INVALID_PARAMETER);
	const std::wstring profile = value.substr(std::wcslen(prefix));
	const size_t separator = profile.find(L':');
	if (separator == std::wstring::npos || profile.size() - separator - 1u != 64u) nativeFailure("authority-profile-shape", ERROR_INVALID_PARAMETER);
	const std::wstring brand = profile.substr(0u, separator);
	if (brand != L"lightscaper-raw") nativeFailure("authority-profile-brand", ERROR_INVALID_PARAMETER);
	if (!std::all_of(profile.begin() + static_cast<ptrdiff_t>(separator + 1u), profile.end(),
		[](wchar_t byte) { return (byte >= L'0' && byte <= L'9') || (byte >= L'a' && byte <= L'f'); })) {
		nativeFailure("authority-profile-digest", ERROR_INVALID_PARAMETER);
	}
	output = profile;
	return true;
}

std::wstring appContainerName(const std::wstring &profile)
{
	const size_t separator = profile.find(L':');
	const std::wstring brand = profile.substr(0u, separator);
	const std::wstring digest = profile.substr(separator + 1u, 40u);
	if (brand == L"lightscaper-raw") return L"Lightscaper.M5.RAW." + digest;
	nativeFailure("appcontainer-name", ERROR_INVALID_PARAMETER);
}

bool registryReadAuthority(const std::wstring &profile)
{
	(void)profile;
	return false; // The fixed zero-path RAW role receives no registry capability.
}

PSID appContainerSid(const std::wstring &profile)
{
	const auto name = appContainerName(profile);
	PSID sid = nullptr;
	HRESULT status = CreateAppContainerProfile(name.c_str(), name.c_str(), name.c_str(), nullptr, 0u, &sid);
	if (status == HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)) {
		status = DeriveAppContainerSidFromAppContainerName(name.c_str(), &sid);
	}
	if (FAILED(status) || sid == nullptr) {
		nativeFailure("appcontainer-profile", static_cast<DWORD>(status));
	}
	return sid;
}

void freeSidArray(PSID *sids, DWORD count)
{
	if (sids == nullptr) return;
	for (DWORD index = 0u; index < count; ++index) LocalFree(sids[index]);
	LocalFree(sids);
}

PSID registryReadCapabilitySid()
{
	PSID *groupSids = nullptr, *capabilitySids = nullptr;
	DWORD groupCount = 0u, capabilityCount = 0u;
	if (!DeriveCapabilitySidsFromName(L"registryRead", &groupSids, &groupCount,
		&capabilitySids, &capabilityCount)) {
		nativeFailure("registry-read-capability", GetLastError());
	}
	if (groupCount != 1u || capabilityCount != 1u
		|| groupSids == nullptr || capabilitySids == nullptr
		|| !IsValidSid(groupSids[0]) || !IsValidSid(capabilitySids[0])) {
		freeSidArray(groupSids, groupCount);
		freeSidArray(capabilitySids, capabilityCount);
		nativeFailure("validate-registry-read-capability", ERROR_INVALID_SID);
	}
	freeSidArray(groupSids, groupCount);
	PSID sid = capabilitySids[0];
	LocalFree(capabilitySids);
	return sid;
}

PSID currentUserSid(std::vector<uintptr_t> &storage)
{
	HANDLE token = nullptr;
	if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
		nativeFailure("open-user-token", GetLastError());
	}
	DWORD bytes = 0u;
	if (GetTokenInformation(token, TokenUser, nullptr, 0u, &bytes)
		|| GetLastError() != ERROR_INSUFFICIENT_BUFFER || bytes < sizeof(TOKEN_USER)) {
		const DWORD code = GetLastError();
		(void)CloseHandle(token);
		nativeFailure("size-user-token", code);
	}
	storage.resize((bytes + sizeof(uintptr_t) - 1u) / sizeof(uintptr_t));
	if (!GetTokenInformation(token, TokenUser, storage.data(), bytes, &bytes)) {
		const DWORD code = GetLastError();
		(void)CloseHandle(token);
		nativeFailure("read-user-token", code);
	}
	if (!CloseHandle(token)) nativeFailure("close-user-token", GetLastError());
	const auto *user = reinterpret_cast<const TOKEN_USER *>(storage.data());
	if (!IsValidSid(user->User.Sid)) nativeFailure("validate-user-sid", ERROR_INVALID_SID);
	return user->User.Sid;
}

void grantExactAccess(HANDLE source, PSID packageSid, PSID userSid, Access access)
{
	const auto path = finalPath(source);
	const HANDLE handle = CreateFileW(path.c_str(), READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES,
		FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
		FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr);
	if (handle == INVALID_HANDLE_VALUE) nativeFailure("open-grant", GetLastError());
	if (!sameFile(source, handle)) nativeFailure("grant-identity", ERROR_INVALID_HANDLE);
	PSECURITY_DESCRIPTOR descriptor = nullptr;
	PACL currentAcl = nullptr, exactAcl = nullptr;
	const DWORD readStatus = GetSecurityInfo(handle, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
		nullptr, nullptr, &currentAcl, nullptr, &descriptor);
	if (readStatus != ERROR_SUCCESS) nativeFailure("read-grant-acl", readStatus);
	const DWORD permissions = access == Access::writeOnly
		? FILE_GENERIC_WRITE | FILE_DELETE_CHILD : FILE_GENERIC_READ
			| (access == Access::readExecute ? FILE_GENERIC_EXECUTE : 0u);
	std::array<EXPLICIT_ACCESSW, 2> entries{};
	for (auto &entry : entries) {
		entry.grfAccessPermissions = permissions;
		entry.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
		entry.Trustee.TrusteeForm = TRUSTEE_IS_SID;
	}
	entries[0].grfAccessMode = SET_ACCESS;
	entries[0].Trustee.TrusteeType = TRUSTEE_IS_GROUP;
	entries[0].Trustee.ptstrName = static_cast<LPWSTR>(packageSid);
	entries[1].grfAccessMode = GRANT_ACCESS;
	entries[1].Trustee.TrusteeType = TRUSTEE_IS_USER;
	entries[1].Trustee.ptstrName = static_cast<LPWSTR>(userSid);
	const DWORD entriesStatus = SetEntriesInAclW(2u, entries.data(), currentAcl, &exactAcl);
	if (entriesStatus != ERROR_SUCCESS) nativeFailure("build-grant-acl", entriesStatus);
	const DWORD writeStatus = SetSecurityInfo(handle, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
		nullptr, nullptr, exactAcl, nullptr);
	if (writeStatus != ERROR_SUCCESS) nativeFailure("apply-grant-acl", writeStatus);
	// This is an exact brand/payload AppContainer policy, not a launcher lease.
	// Its security never depends on a later restore that a crash could skip.
	LocalFree(exactAcl);
	LocalFree(descriptor);
	CloseHandle(handle);
}

std::wstring quote(const std::wstring &value)
{
	if (value.find_first_of(L" \t\"") == std::wstring::npos) return value;
	std::wstring output = L"\""; size_t slashes = 0u;
	for (const wchar_t byte : value) {
		if (byte == L'\\') { ++slashes; continue; }
		if (byte == L'\"') output.append(slashes * 2u + 1u, L'\\');
		else output.append(slashes, L'\\');
		slashes = 0u; output.push_back(byte);
	}
	output.append(slashes * 2u, L'\\'); return output + L"\"";
}

std::vector<unsigned char> crtDescriptors(HANDLE extraInput)
{
	const int count = extraInput == nullptr ? 3 : 4;
	std::vector<unsigned char> bytes(sizeof(int) + static_cast<size_t>(count)
		+ static_cast<size_t>(count) * sizeof(intptr_t), 0u);
	std::memcpy(bytes.data(), &count, sizeof(count));
	auto *flags = bytes.data() + sizeof(int);
	const size_t handleOffset = sizeof(int) + static_cast<size_t>(count);
	for (int index = 0; index < count; ++index) {
		const DWORD selector = index == 0 ? STD_INPUT_HANDLE : index == 1 ? STD_OUTPUT_HANDLE : STD_ERROR_HANDLE;
		const HANDLE handle = index < 3 ? GetStdHandle(selector) : extraInput;
		if (handle == nullptr || handle == INVALID_HANDLE_VALUE) nativeFailure("stdio-handle", ERROR_INVALID_HANDLE);
		if (!SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) nativeFailure("stdio-inherit", GetLastError());
		flags[index] = 0x09u;
		const auto raw = reinterpret_cast<intptr_t>(handle);
		std::memcpy(bytes.data() + handleOffset + static_cast<size_t>(index) * sizeof(raw), &raw, sizeof(raw));
	}
	return bytes;
}
}

#include "photo_windows_image.hpp"

int wmain(int argc, wchar_t **argv)
{
	Values values; std::vector<std::wstring> child; bool separator = false;
	for (int index = 1; index < argc; ++index) {
		const std::wstring option(argv[index]);
		if (separator) { child.push_back(option); continue; }
		if (option == L"--") { separator = true; continue; }
		if (exactFd(option, L"--enforcement-fd=", values.enforcement, &values.enforcementFd)
			|| exactFd(option, L"--profile-fd=", values.profile)
			|| exactFd(option, L"--broker-policy-fd=", values.broker)
   || exactFd(option, L"--control-fd=", values.control)
			|| exactFd(option, L"--executable-fd=", values.executable)
			|| exactFd(option, L"--extra-input-fd=", values.extraInput)
			|| authorityProfile(option, values.authorityProfile)) continue;
		for (const auto &[prefix, access] : std::array{
			std::pair{L"--read-only-fd=", Access::readOnly},
			std::pair{L"--read-execute-fd=", Access::readExecute},
			std::pair{L"--write-only-fd=", Access::writeOnly},
		}) {
			HANDLE handle = nullptr;
			if (exactFd(option, prefix, handle)) { values.grants.push_back({handle, access}); goto admitted; }
		}
		if (option.rfind(L"--maximum-rss-bytes=", 0u) == 0u) {
			if (values.rss != 0u) nativeFailure("duplicate-rss", ERROR_INVALID_PARAMETER);
			uint64_t value = 0u; if (!exactNumber(option, L"--maximum-rss-bytes=", value)) nativeFailure("rss-option", ERROR_INVALID_PARAMETER);
			if (value > static_cast<uint64_t>(SIZE_MAX)) nativeFailure("rss-overflow", ERROR_INVALID_PARAMETER);
   values.rss = static_cast<SIZE_T>(value); continue;
		}
		if (exactNumber(option, L"--maximum-duration-ms=", values.durationMs)) continue;
		nativeFailure("unknown-option", ERROR_INVALID_PARAMETER);
	admitted: if (values.grants.size() > maximumGrants) nativeFailure("grant-count", ERROR_INVALID_PARAMETER);
	}
	if (!separator || values.enforcement == nullptr || values.profile == nullptr || values.broker == nullptr
		|| values.executable == nullptr || values.control == nullptr || values.authorityProfile.empty()
		|| values.rss == 0u || values.durationMs == 0u || child.empty()) nativeFailure("required-options", ERROR_INVALID_PARAMETER);
	std::vector<HANDLE> unique{ values.enforcement, values.profile, values.broker, values.executable, values.control };
	if (values.extraInput != nullptr) unique.push_back(values.extraInput);
	for (const auto &grant : values.grants) unique.push_back(grant.handle);
	std::sort(unique.begin(), unique.end());
	if (std::adjacent_find(unique.begin(), unique.end()) != unique.end()) nativeFailure("descriptor-alias", ERROR_INVALID_PARAMETER);

	if (!values.grants.empty() || values.extraInput != nullptr || child.size() != 1u || child[0] != L"lightscaper-photo-native-raw"
  || values.durationMs > 30000u || values.rss > 805306368u) nativeFailure("fixed-raw-policy", ERROR_INVALID_PARAMETER);
 PhotoWindowsImage image(values.executable);
 const auto executable = image.path();
	std::wstring command = quote(executable);
	for (size_t childIndex = 1u; childIndex < child.size(); ++childIndex) {
		command += L" " + quote(child[childIndex]);
	}
	PSID sid = appContainerSid(values.authorityProfile);
	PSID registryReadSid = registryReadAuthority(values.authorityProfile)
		? registryReadCapabilitySid() : nullptr;
	std::vector<uintptr_t> userSidStorage;
	PSID userSid = currentUserSid(userSidStorage);
	grantExactAccess(values.executable, sid, userSid, Access::readExecute);
	for (const auto &grant : values.grants) grantExactAccess(grant.handle, sid, userSid, grant.access);
	SID_AND_ATTRIBUTES registryRead{ registryReadSid, SE_GROUP_ENABLED };
	SECURITY_CAPABILITIES capabilities{ sid,
		registryReadSid == nullptr ? nullptr : &registryRead,
		registryReadSid == nullptr ? 0u : 1u, 0u };
	DWORD allApplicationPackagesPolicy = PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT;
	const auto crt = crtDescriptors(values.extraInput);
	std::vector<HANDLE> inherited{ GetStdHandle(STD_INPUT_HANDLE), GetStdHandle(STD_OUTPUT_HANDLE),
		GetStdHandle(STD_ERROR_HANDLE) };
	if (values.extraInput != nullptr) inherited.push_back(values.extraInput);
	SIZE_T bytes = 0u; InitializeProcThreadAttributeList(nullptr, 4u, 0u, &bytes);
	std::vector<unsigned char> storage(bytes);
	auto *attributes = reinterpret_cast<PPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
	if (!InitializeProcThreadAttributeList(attributes, 4u, 0u, &bytes)) {
		nativeFailure("initialize-attributes", GetLastError());
	}
	if (!UpdateProcThreadAttribute(attributes, 0u, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
		&capabilities, sizeof(capabilities), nullptr, nullptr)) {
		nativeFailure("security-capabilities", GetLastError());
	}
	if (!UpdateProcThreadAttribute(attributes, 0u,
		PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY,
		&allApplicationPackagesPolicy, sizeof(allApplicationPackagesPolicy), nullptr, nullptr)) {
		nativeFailure("all-application-packages-policy", GetLastError());
	}
	if (!UpdateProcThreadAttribute(attributes, 0u, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
		inherited.data(), inherited.size() * sizeof(HANDLE), nullptr, nullptr)) {
		nativeFailure("inherited-handles", GetLastError());
	}
 DWORD64 mitigations = PROCESS_CREATION_MITIGATION_POLICY_PROHIBIT_DYNAMIC_CODE_ALWAYS_ON;
 if (!UpdateProcThreadAttribute(attributes, 0u, PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY,
  &mitigations, sizeof(mitigations), nullptr, nullptr)) nativeFailure("dynamic-code-policy", GetLastError());
	HANDLE job = CreateJobObjectW(nullptr, nullptr);
	JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
	limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
		| JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_PROCESS_TIME;
	limits.BasicLimitInformation.ActiveProcessLimit = 1u; limits.ProcessMemoryLimit = values.rss;
	limits.BasicLimitInformation.PerProcessUserTimeLimit.QuadPart = static_cast<LONGLONG>(values.durationMs) * 10000ll;
	if (job == nullptr) nativeFailure("create-job", GetLastError());
	if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
		nativeFailure("configure-job", GetLastError());
	}
	STARTUPINFOEXW startup{}; startup.StartupInfo.cb = sizeof(startup); startup.lpAttributeList = attributes;
	startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
	startup.StartupInfo.hStdInput = inherited[0]; startup.StartupInfo.hStdOutput = inherited[1];
	startup.StartupInfo.hStdError = inherited[2]; startup.StartupInfo.cbReserved2 = static_cast<WORD>(crt.size());
	startup.StartupInfo.lpReserved2 = const_cast<LPBYTE>(crt.data());
	PROCESS_INFORMATION process{}; const wchar_t emptyEnvironment[2]{};
	if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE,
		CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
		const_cast<wchar_t*>(emptyEnvironment), nullptr, &startup.StartupInfo, &process)) {
		nativeFailure("create-process", GetLastError());
	}
	photoSupervisedProcess = process.hProcess;
	if (!AssignProcessToJobObject(job, process.hProcess)) {
		const DWORD code = GetLastError();
		(void)TerminateProcess(process.hProcess, 125u);
		nativeFailure("assign-job", code);
	}
	image.verify(process.hProcess);
	DWORD written = 0u;
	if (!WriteFile(values.enforcement, enforcementFrame, sizeof(enforcementFrame) - 1u, &written, nullptr)
		|| written != sizeof(enforcementFrame) - 1u || _close(values.enforcementFd) != 0) nativeFailure("enforcement-write", GetLastError());
	values.enforcementFd = -1;
	values.enforcement = nullptr;
	if (ResumeThread(process.hThread) == static_cast<DWORD>(-1)) nativeFailure("resume-thread", GetLastError());
 const ULONGLONG started = GetTickCount64();
 for (;;) {
  const DWORD status = WaitForSingleObject(process.hProcess, 10u);
  if (status == WAIT_OBJECT_0) break;
  if (status != WAIT_TIMEOUT) nativeFailure("wait-peer", GetLastError());
  DWORD available = 0u;
  const BOOL connected = PeekNamedPipe(values.control, nullptr, 0u, nullptr, &available, nullptr);
  if (!connected || available != 0u || GetTickCount64() - started >= values.durationMs) { joinPhotoSupervised(true); break; }
 }
 photoSupervisedProcess = nullptr;
	DWORD exitCode = 125u; GetExitCodeProcess(process.hProcess, &exitCode);
	CloseHandle(process.hThread); CloseHandle(process.hProcess); CloseHandle(job);
	DeleteProcThreadAttributeList(attributes);
	if (registryReadSid != nullptr) LocalFree(registryReadSid);
	FreeSid(sid);
	return static_cast<int>(exitCode);
}
