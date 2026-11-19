/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include "protocol.hpp"
#include <bcrypt.h>
#include <algorithm>

namespace lightscaper::association {
struct Cleanup { bool okay = true; void note(bool value) { okay = okay && value; } };
class Handle {
	HANDLE value = nullptr; Cleanup &cleanup;
public:
	explicit Handle(Cleanup &owner) : cleanup(owner) {}
	~Handle() { close(); }
	Handle(const Handle &) = delete; Handle &operator=(const Handle &) = delete;
	void set(HANDLE input) { require(value == nullptr, "handle-already-owned"); value = input; }
	HANDLE get() const { return value; }
	void close() { if (value != nullptr && value != INVALID_HANDLE_VALUE) { const HANDLE held = value; value = nullptr; cleanup.note(CloseHandle(held) != FALSE); } }
};
inline bool equal(const std::wstring &a, const std::wstring &b) {
	return CompareStringOrdinal(a.c_str(), static_cast<int>(a.size()), b.c_str(), static_cast<int>(b.size()), TRUE) == CSTR_EQUAL;
}
inline void absolute(const std::wstring &path) {
	require(path.size() > 3u && path.size() < 32760u && ((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z'))
		&& path[1] == L':' && path[2] == L'\\' && path.find(L'/') == std::wstring::npos, "local-absolute-path");
	size_t first = 3u;
	while (first < path.size()) { const size_t end = path.find(L'\\', first); const auto part = path.substr(first, end - first);
		require(!part.empty() && part != L"." && part != L".." && part.back() != L'.' && part.back() != L' ' && part.find(L':') == std::wstring::npos, "canonical-path-component");
		if (end == std::wstring::npos) break; first = end + 1u;
	}
}
inline std::wstring finalPath(HANDLE handle) {
	std::array<wchar_t, 32768> buffer{}; const DWORD count = GetFinalPathNameByHandleW(handle, buffer.data(), static_cast<DWORD>(buffer.size()), FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
	require(count > 4u && count < buffer.size(), "final-file-path"); std::wstring result(buffer.data(), count);
	require(result.substr(0u, 4u) == L"\\\\?\\", "final-file-prefix"); result.erase(0u, 4u); absolute(result); return result;
}
inline BY_HANDLE_FILE_INFORMATION info(HANDLE file) {
	BY_HANDLE_FILE_INFORMATION value{}; checked(GetFileInformationByHandle(file, &value), "file-information");
	require(GetFileType(file) == FILE_TYPE_DISK && (value.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) == 0u
		&& value.nNumberOfLinks == 1u, "regular-unlinked-file"); return value;
}
inline bool same(const BY_HANDLE_FILE_INFORMATION &a, const BY_HANDLE_FILE_INFORMATION &b) {
	return a.dwVolumeSerialNumber == b.dwVolumeSerialNumber && a.nFileIndexHigh == b.nFileIndexHigh && a.nFileIndexLow == b.nFileIndexLow
		&& a.nFileSizeHigh == b.nFileSizeHigh && a.nFileSizeLow == b.nFileSizeLow && a.dwFileAttributes == b.dwFileAttributes
		&& a.nNumberOfLinks == b.nNumberOfLinks && CompareFileTime(&a.ftLastWriteTime, &b.ftLastWriteTime) == 0;
}
inline uint64_t size(const BY_HANDLE_FILE_INFORMATION &value) { return (static_cast<uint64_t>(value.nFileSizeHigh) << 32u) | value.nFileSizeLow; }
inline void openFile(Handle &handle, const std::wstring &path) {
	absolute(path); handle.set(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, nullptr));
	require(handle.get() != INVALID_HANDLE_VALUE, "open-file"); (void)info(handle.get()); require(equal(finalPath(handle.get()), path), "file-path-alias");
}
inline std::string readFile(HANDLE file) {
	const auto before = info(file); require(size(before) > 0u && size(before) <= 65536u, "request-file-size");
	std::string bytes(static_cast<size_t>(size(before)), '\0'); DWORD count = 0u;
	checked(ReadFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &count, nullptr), "read-request");
	require(count == bytes.size() && same(before, info(file)), "request-file-changed"); return bytes;
}
inline std::string digest(HANDLE file, Cleanup &cleanup) {
	BCRYPT_ALG_HANDLE algorithm = nullptr; BCRYPT_HASH_HANDLE hash = nullptr; std::array<unsigned char, 32> output{};
	std::array<unsigned char, 65536> bytes{};
	try {
		require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0u) >= 0, "sha256-provider");
		require(BCryptCreateHash(algorithm, &hash, nullptr, 0u, nullptr, 0u, 0u) >= 0, "sha256-create");
		for (;;) { DWORD read = 0u; checked(ReadFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &read, nullptr), "read-archive"); if (read == 0u) break;
			require(BCryptHashData(hash, bytes.data(), read, 0u) >= 0, "sha256-update"); }
		require(BCryptFinishHash(hash, output.data(), static_cast<ULONG>(output.size()), 0u) >= 0, "sha256-finish");
	} catch (...) { SecureZeroMemory(bytes.data(), bytes.size()); if (hash != nullptr) cleanup.note(BCryptDestroyHash(hash) >= 0); if (algorithm != nullptr) cleanup.note(BCryptCloseAlgorithmProvider(algorithm, 0u) >= 0); throw; }
	SecureZeroMemory(bytes.data(), bytes.size()); cleanup.note(BCryptDestroyHash(hash) >= 0); cleanup.note(BCryptCloseAlgorithmProvider(algorithm, 0u) >= 0);
	std::string result; const char *digits = "0123456789abcdef";
	for (const auto byte : output) { result += digits[byte >> 4u]; result += digits[byte & 15u]; } SecureZeroMemory(output.data(), output.size()); return result;
}
class Result {
	Handle parent, file;
public:
	Result(const std::wstring &path, Cleanup &cleanup) : parent(cleanup), file(cleanup) {
		absolute(path); const auto split = path.find_last_of(L'\\'); require(split != std::wstring::npos, "result-parent");
		parent.set(CreateFileW(path.substr(0u, split).c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
		require(parent.get() != INVALID_HANDLE_VALUE, "result-parent-open"); BY_HANDLE_FILE_INFORMATION metadata{};
		checked(GetFileInformationByHandle(parent.get(), &metadata), "result-parent-info");
		require((metadata.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0u && (metadata.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0u
			&& equal(finalPath(parent.get()), path.substr(0u, split)), "result-parent-alias");
		file.set(CreateFileW(path.c_str(), GENERIC_WRITE | FILE_READ_ATTRIBUTES, 0u, nullptr, CREATE_NEW, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_WRITE_THROUGH, nullptr));
		require(file.get() != INVALID_HANDLE_VALUE, "fresh-result-file"); (void)info(file.get());
	}
	void publish(const std::string &body) {
		require(body.size() <= 262144u, "result-size"); DWORD written = 0u;
		checked(WriteFile(file.get(), body.data(), static_cast<DWORD>(body.size()), &written, nullptr), "write-result");
		require(written == body.size(), "result-short-write"); checked(FlushFileBuffers(file.get()), "flush-result"); file.close(); parent.close();
	}
};
}
