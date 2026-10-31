/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include <windows.h>
#include <algorithm>
#include <array>
#include <string>
#include <vector>

namespace lightscaper::canary {
struct Failure { std::string stage; DWORD code; };
inline void require(bool okay, const char *stage) {
	if (!okay) throw Failure{stage, GetLastError()};
}
inline void expect(bool okay, const char *stage) {
	if (!okay) throw Failure{stage, ERROR_INVALID_DATA};
}
class Handle {
	HANDLE value_ = nullptr;
public:
	Handle() = default;
	explicit Handle(HANDLE value) : value_(value) {}
	Handle(const Handle &) = delete;
	Handle &operator=(const Handle &) = delete;
	~Handle() { if (valid()) (void)CloseHandle(value_); }
	bool valid() const { return value_ != nullptr && value_ != INVALID_HANDLE_VALUE; }
	HANDLE get() const { return value_; }
	void set(HANDLE value) { expect(!valid(), "replace-owned-handle"); value_ = value; }
	void close(const char *stage) {
		if (valid()) { require(CloseHandle(value_) != FALSE, stage); value_ = nullptr; }
	}
};
inline std::wstring path(const std::wstring &root, const wchar_t *name) { return root + L"\\" + name; }
inline bool exists(const std::wstring &name) {
	const DWORD attributes = GetFileAttributesW(name.c_str());
	if (attributes != INVALID_FILE_ATTRIBUTES) return true;
	const DWORD code = GetLastError();
	if (code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND) return false;
	throw Failure{"file-attributes", code};
}
inline void writeNew(const std::wstring &name, const std::string &bytes) {
	Handle file(CreateFileW(name.c_str(), GENERIC_WRITE, 0u, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
	require(file.valid(), "create-new-file");
	DWORD written = 0u;
	require(WriteFile(file.get(), bytes.data(), static_cast<DWORD>(bytes.size()), &written, nullptr) != FALSE, "write-file");
	expect(written == bytes.size(), "write-all-bytes");
	require(FlushFileBuffers(file.get()) != FALSE, "flush-file"); file.close("close-written-file");
}
inline std::string readSmall(const std::wstring &name) {
	Handle file(CreateFileW(name.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
		nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
	require(file.valid(), "read-marker");
	std::array<char, 256> bytes{}; DWORD count = 0u;
	require(ReadFile(file.get(), bytes.data(), static_cast<DWORD>(bytes.size()), &count, nullptr) != FALSE, "read-marker-bytes");
	expect(count > 0u && count < bytes.size(), "bounded-marker"); file.close("close-marker");
	return std::string(bytes.data(), count);
}
inline bool ended(HANDLE process, DWORD milliseconds) {
	const DWORD result = WaitForSingleObject(process, milliseconds);
	if (result == WAIT_OBJECT_0) return true;
	if (result == WAIT_TIMEOUT) return false;
	if (result == WAIT_FAILED) throw Failure{"wait-process", GetLastError()};
	throw Failure{"wait-process", ERROR_INVALID_DATA};
}
inline DWORD exitCode(HANDLE process) {
	DWORD code = 0u; require(GetExitCodeProcess(process, &code) != FALSE, "process-exit-code"); return code;
}
inline std::wstring quote(const std::wstring &argument) {
	std::wstring result = L"\""; size_t slashes = 0u;
	for (wchar_t c : argument) {
		if (c == L'\\') { ++slashes; continue; }
		if (c == L'"') { result.append(slashes * 2u + 1u, L'\\'); result += c; }
		else { result.append(slashes, L'\\'); result += c; }
		slashes = 0u;
	}
	result.append(slashes * 2u, L'\\'); result += L'"'; return result;
}
inline std::wstring command(const std::wstring &executable, const std::vector<std::wstring> &args) {
	std::wstring result = quote(executable);
	for (const auto &argument : args) { result += L' '; result += quote(argument); }
	expect(result.size() < 32767u, "bounded-command-line"); return result;
}
inline std::wstring self() {
	std::array<wchar_t, 32768> name{};
	const DWORD size = GetModuleFileNameW(nullptr, name.data(), static_cast<DWORD>(name.size()));
	require(size != 0u, "module-file-name"); expect(size < name.size(), "bounded-module-path");
	return std::wstring(name.data(), size);
}
inline void closeStandardStreams() {
	std::array<HANDLE, 3> closed{}; size_t count = 0u;
	for (DWORD selector : {STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE}) {
		const HANDLE stream = GetStdHandle(selector);
		bool duplicate = false;
		for (size_t index = 0u; index < count; ++index) if (closed[index] == stream) duplicate = true;
		if (stream != nullptr && stream != INVALID_HANDLE_VALUE && !duplicate) {
			require(CloseHandle(stream) != FALSE, "close-fixture-stdio"); closed[count++] = stream;
		}
		require(SetStdHandle(selector, nullptr) != FALSE, "clear-fixture-stdio");
	}
}
inline PROCESS_INFORMATION spawnDescendant(const std::wstring &executable, const std::vector<std::wstring> &args) {
	STARTUPINFOW startup{}; startup.cb = static_cast<DWORD>(sizeof(startup));
	PROCESS_INFORMATION process{}; std::wstring line = command(executable, args);
	require(CreateProcessW(executable.c_str(), line.data(), nullptr, nullptr, FALSE,
		CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr, &startup, &process) != FALSE, "spawn-fixture-descendant");
	return process;
}
inline void waitReady(const std::wstring &name, DWORD milliseconds) {
	const ULONGLONG began = GetTickCount64();
	while (!exists(name)) {
		if (GetTickCount64() - began >= milliseconds) throw Failure{"wait-reader-ready", ERROR_TIMEOUT};
		Sleep(10u);
	}
}
inline JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting(HANDLE job) {
	JOBOBJECT_BASIC_ACCOUNTING_INFORMATION result{}; DWORD returned = 0u;
	require(QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &result,
		static_cast<DWORD>(sizeof(result)), &returned) != FALSE, "query-outer-job");
	expect(returned == sizeof(result), "outer-accounting-size"); return result;
}
inline bool waitEmpty(HANDLE job, DWORD milliseconds) {
	const ULONGLONG began = GetTickCount64();
	for (;;) {
		if (accounting(job).ActiveProcesses == 0u) return true;
		if (GetTickCount64() - began >= milliseconds) return false;
		Sleep(10u);
	}
}
} // namespace lightscaper::canary
