/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include "files.hpp"
#include <shellapi.h>
#include <shlwapi.h>
#include <optional>
#include <objbase.h>

namespace lightscaper::association {
struct Operations { unsigned com = 0u, association = 0u, job = 0u, shell = 0u; };
inline Operations operations;
inline std::string operationsJson() {
	return "{\"comInitializations\":" + std::to_string(operations.com) + ",\"associationQueries\":" + std::to_string(operations.association)
		+ ",\"callingJobQueries\":" + std::to_string(operations.job) + ",\"shellExecuteCalls\":" + std::to_string(operations.shell) + '}';
}
class Com {
	bool initialized = false;
public:
	Com() { ++operations.com; const HRESULT value = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED); require(SUCCEEDED(value), "com-initialize"); initialized = true; }
	~Com() { if (initialized) CoUninitialize(); }
	Com(const Com &) = delete; Com &operator=(const Com &) = delete;
};
struct Query { HRESULT code = E_UNEXPECTED; std::optional<std::wstring> value; };
inline Query query(const wchar_t *extension, ASSOCSTR selector) {
	DWORD count = 0u; const ASSOCF flags = static_cast<ASSOCF>(ASSOCF_NOTRUNCATE | ASSOCF_INIT_IGNOREUNKNOWN);
	++operations.association; const HRESULT first = AssocQueryStringW(flags, selector, extension, L"open", nullptr, &count);
	if (first != S_FALSE) return {first, std::nullopt};
	require(count > 1u && count <= 8192u, "association-string-size"); std::vector<wchar_t> buffer(count, L'\0');
	++operations.association; const HRESULT code = AssocQueryStringW(flags, selector, extension, L"open", buffer.data(), &count);
	if (code != S_OK) return {code, std::nullopt};
	require(count > 0u && count <= buffer.size() && buffer[count - 1u] == L'\0', "association-string-termination");
	std::wstring value(buffer.data()); require(value.size() + 1u == count, "association-string-nul"); return {code, value};
}
inline std::string queryJson(const Query &value) {
	return "{\"hresult\":" + std::to_string(static_cast<uint32_t>(value.code)) + ",\"value\":"
		+ (value.value ? quote(utf8(*value.value)) : "null") + '}';
}
struct Association { Query executable, progId, command; };
inline Association association(const wchar_t *extension) {
	return {query(extension, ASSOCSTR_EXECUTABLE), query(extension, ASSOCSTR_PROGID), query(extension, ASSOCSTR_COMMAND)};
}
inline std::string associationJson(const Association &value) {
	return "{\"executable\":" + queryJson(value.executable) + ",\"progId\":" + queryJson(value.progId) + ",\"command\":" + queryJson(value.command) + '}';
}
inline bool same(const Query &a, const Query &b) { return a.code == b.code && a.value == b.value; }
inline bool same(const Association &a, const Association &b) { return same(a.executable, b.executable) && same(a.progId, b.progId) && same(a.command, b.command); }
inline std::wstring required(const Query &value) { require(value.code == S_OK && value.value && !value.value->empty(), "association-default-unavailable"); return *value.value; }
struct Registry { LSTATUS code = ERROR_INVALID_DATA; std::optional<std::wstring> value; };
inline Registry registry(const std::wstring &path, const wchar_t *name, Cleanup &cleanup) {
	HKEY key = nullptr; const LSTATUS opened = RegOpenKeyExW(HKEY_CURRENT_USER, path.c_str(), 0u, KEY_QUERY_VALUE | KEY_WOW64_64KEY, &key);
	if (opened != ERROR_SUCCESS) return {opened, std::nullopt};
	std::array<wchar_t, 8192> buffer{}; DWORD type = 0u, bytes = static_cast<DWORD>(buffer.size() * sizeof(wchar_t));
	const LSTATUS result = RegQueryValueExW(key, name, nullptr, &type, reinterpret_cast<BYTE *>(buffer.data()), &bytes);
	cleanup.note(RegCloseKey(key) == ERROR_SUCCESS);
	if (result != ERROR_SUCCESS) return {result, std::nullopt};
	require(type == REG_SZ && bytes >= sizeof(wchar_t) && bytes <= buffer.size() * sizeof(wchar_t)
		&& bytes % sizeof(wchar_t) == 0u && buffer[bytes / sizeof(wchar_t) - 1u] == L'\0', "registry-string");
	std::wstring value(buffer.data()); require((value.size() + 1u) * sizeof(wchar_t) == bytes, "registry-string-nul"); return {result, value};
}
inline std::string registryJson(const Registry &value) {
	return "{\"win32\":" + std::to_string(value.code) + ",\"value\":" + (value.value ? quote(utf8(*value.value)) : "null") + '}';
}
inline std::wstring required(const Registry &value) { require(value.code == ERROR_SUCCESS && value.value && !value.value->empty(), "per-user-association-unavailable"); return *value.value; }
inline void safeProgId(const std::wstring &value) {
	require(value == L"Lightscaper Catalog", "progid-not-owned");
}
inline std::vector<DWORD> jobProcesses() {
	struct List { DWORD assigned = 0u, count = 0u; ULONG_PTR pids[256]{}; } list;
	static_assert(offsetof(List, pids) == offsetof(JOBOBJECT_BASIC_PROCESS_ID_LIST, ProcessIdList));
	++operations.job; checked(QueryInformationJobObject(nullptr, JobObjectBasicProcessIdList, &list, static_cast<DWORD>(sizeof(list)), nullptr), "calling-job-query");
	require(list.count > 0u && list.count <= 256u && list.assigned == list.count, "calling-job-list-incomplete"); std::vector<DWORD> result;
	for (DWORD i = 0u; i < list.count; ++i) { require(list.pids[i] > 0u && list.pids[i] <= std::numeric_limits<DWORD>::max(), "calling-job-pid"); result.push_back(static_cast<DWORD>(list.pids[i])); }
	std::sort(result.begin(), result.end()); require(std::adjacent_find(result.begin(), result.end()) == result.end(), "calling-job-duplicate");
	require(std::binary_search(result.begin(), result.end(), GetCurrentProcessId()), "calling-job-self-absent"); return result;
}
inline std::string pidsJson(const std::vector<DWORD> &value) {
	std::string result = "["; for (size_t i = 0u; i < value.size(); ++i) { if (i) result += ','; result += std::to_string(value[i]); } return result + ']';
}
struct Process { DWORD pid = 0u; uint64_t created = 0u; std::wstring executable; };
inline Process process(HANDLE handle) {
	Process value; value.pid = GetProcessId(handle); require(value.pid > 0u, "process-pid");
	std::array<wchar_t, 32768> buffer{}; DWORD count = static_cast<DWORD>(buffer.size());
	checked(QueryFullProcessImageNameW(handle, 0u, buffer.data(), &count), "process-path"); require(count > 0u && count < buffer.size(), "process-path-size");
	value.executable.assign(buffer.data(), count); absolute(value.executable);
	FILETIME created{}, exited{}, kernel{}, user{}; checked(GetProcessTimes(handle, &created, &exited, &kernel, &user), "process-creation");
	value.created = (static_cast<uint64_t>(created.dwHighDateTime) << 32u) | created.dwLowDateTime; require(value.created > 0u, "process-creation-empty"); return value;
}
inline std::string processJson(const Process &value) {
	if (value.pid == 0u) return "null";
	return "{\"pid\":" + std::to_string(value.pid) + ",\"creationTime100ns\":" + quote(std::to_string(value.created)) + ",\"executablePath\":" + quote(utf8(value.executable)) + '}';
}
inline std::vector<DWORD> joinedChildren(DWORD milliseconds) {
	const ULONGLONG began = GetTickCount64();
	for (;;) { const auto current = jobProcesses(); if (current.size() == 1u) return current;
		if (GetTickCount64() - began >= milliseconds) throw Failure{"calling-job-children-unretired", ERROR_TIMEOUT}; Sleep(20u); }
}
}
