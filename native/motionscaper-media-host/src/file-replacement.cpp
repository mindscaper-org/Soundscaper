/* SPDX-License-Identifier: AGPL-3.0-only */
#include "file-replacement.hpp"
#include <algorithm>
#include <charconv>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <memory>
#include <new>
#include <optional>
#include <stdexcept>
#include <string>
#ifdef _WIN32
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#ifndef NTDDI_VERSION
#define NTDDI_VERSION 0x0A000002
#endif
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winternl.h>
#endif

namespace motionscaper::files {
namespace {
struct identity final {
	std::uint64_t device;
	std::uint64_t inode;
	bool operator==(const identity&) const = default;
};
std::uint64_t unsigned_id(std::string_view value) {
	if (value.empty() || value.size() > 20 || (value.size() > 1 && value.front() == '0')
		|| value.find_first_not_of("0123456789") != std::string_view::npos) throw std::runtime_error("Noncanonical replacement file identity.");
	std::uint64_t result{};
	const auto parsed = std::from_chars(value.data(), value.data() + value.size(), result);
	if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size()) throw std::runtime_error("Replacement file identity exceeds uint64.");
	return result;
}
std::filesystem::path absolute_path(std::string_view value) {
	if (value.empty() || value.size() > 131068 || value.find('\0') != std::string_view::npos) throw std::runtime_error("Invalid replacement path bounds.");
	const std::filesystem::path path{std::u8string_view{reinterpret_cast<const char8_t*>(value.data()), value.size()}};
	if (!path.is_absolute() || path != path.lexically_normal() || path.filename().empty()
		|| path.filename() == "." || path.filename() == "..") throw std::runtime_error("Replacement requires normalized absolute file paths.");
	return path;
}
#ifdef _WIN32
class owned_handle final {
public:
	explicit owned_handle(HANDLE value) noexcept : value_(value) {}
	~owned_handle() { if (value_ != INVALID_HANDLE_VALUE) CloseHandle(value_); }
	owned_handle(const owned_handle&) = delete;
	owned_handle& operator=(const owned_handle&) = delete;
	HANDLE get() const noexcept { return value_; }
private:
	HANDLE value_;
};
[[noreturn]] void fail(const char* phase) {
	const auto error = GetLastError();
	throw std::runtime_error(std::string{"Motion file replacement "} + phase + " failed (Windows error " + std::to_string(error) + ").");
}
identity inspect(HANDLE file, bool directory) {
	BY_HANDLE_FILE_INFORMATION info{};
	if (!GetFileInformationByHandle(file, &info)) fail("handle identity");
	if (GetFileType(file) != FILE_TYPE_DISK || (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
		|| ((info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) != directory) throw std::runtime_error("Replacement requires direct regular files and a non-reparse directory.");
	return {info.dwVolumeSerialNumber, static_cast<std::uint64_t>(info.nFileIndexHigh) << 32U | info.nFileIndexLow};
}
void assert_identity(HANDLE file, const identity& expected, bool directory) {
	if (inspect(file, directory) != expected) throw std::runtime_error("Motion replacement file or parent identity changed.");
}
HANDLE open_path(const std::filesystem::path& path, DWORD access, DWORD sharing) {
	return CreateFileW(path.c_str(), access, sharing, nullptr, OPEN_EXISTING,
		FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr);
}
void recapture(const std::filesystem::path& path, const std::optional<identity>& expected, bool directory = false) {
	owned_handle file{open_path(path, FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)};
	if (file.get() == INVALID_HANDLE_VALUE) {
		if (!expected && GetLastError() == ERROR_FILE_NOT_FOUND) return;
		fail("path recapture");
	}
	if (!expected) throw std::runtime_error("Motion replacement destination is no longer absent.");
	assert_identity(file.get(), *expected, directory);
}
void windows_path(const std::filesystem::path& path) {
	const auto& value = path.native(); const auto leaf = path.filename().native();
	if (value.size() > 32767 || value.starts_with(L"\\\\.\\") || value.starts_with(L"\\\\?\\")
		|| leaf.find_first_of(L"<>:\"|?*") != std::wstring::npos || leaf.back() == L'.' || leaf.back() == L' '
		|| std::any_of(leaf.begin(), leaf.end(), [](wchar_t character) { return character < 32; })) throw std::runtime_error("Unsupported Windows replacement path.");
}
void replace_windows(const std::filesystem::path& source, const std::filesystem::path& destination,
	const identity& parent_id, const identity& source_id, const std::optional<identity>& destination_id) {
	windows_path(source); windows_path(destination);
	const auto parent = destination.parent_path();
	// Deny DELETE sharing for the selected parent throughout all validation and mutation.
	owned_handle directory{open_path(parent, FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_READ_ATTRIBUTES | SYNCHRONIZE, FILE_SHARE_READ | FILE_SHARE_WRITE)};
	if (directory.get() == INVALID_HANDLE_VALUE) fail("parent open");
	assert_identity(directory.get(), parent_id, true);
	owned_handle input{open_path(source, FILE_READ_ATTRIBUTES | DELETE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)};
	if (input.get() == INVALID_HANDLE_VALUE) fail("source open");
	assert_identity(input.get(), source_id, false);
	if (source_id.device != parent_id.device || (destination_id && (destination_id->device != parent_id.device || *destination_id == source_id))) throw std::runtime_error("Replacement files must have distinct identities on the selected volume.");
	owned_handle previous{open_path(destination, FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)};
	if (previous.get() == INVALID_HANDLE_VALUE) {
		if (destination_id || GetLastError() != ERROR_FILE_NOT_FOUND) fail("destination open");
	} else {
		if (!destination_id) throw std::runtime_error("Motion replacement destination already exists.");
		assert_identity(previous.get(), *destination_id, false);
	}
	const auto name = destination.filename().native();
	const auto name_bytes = name.size() * sizeof(wchar_t);
	const auto size = std::max(sizeof(FILE_RENAME_INFO), offsetof(FILE_RENAME_INFO, FileName) + name_bytes + sizeof(wchar_t));
	auto storage = std::make_unique<std::byte[]>(size);
	auto* rename = new (storage.get()) FILE_RENAME_INFO{};
	rename->Flags = destination_id ? FILE_RENAME_FLAG_REPLACE_IF_EXISTS | FILE_RENAME_FLAG_POSIX_SEMANTICS : 0;
	rename->RootDirectory = directory.get();
	rename->FileNameLength = static_cast<DWORD>(name_bytes);
	std::memcpy(rename->FileName, name.c_str(), name_bytes + sizeof(wchar_t));
	// Desktop SDK headers omit the extended native information class. Its documented
	// value is 65; unlike the Win32 wrapper it accepts our held-directory anchor.
	using set_information = NTSTATUS (NTAPI*)(HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG, ULONG);
	using status_to_error = ULONG (WINAPI*)(NTSTATUS);
	const auto module = GetModuleHandleW(L"ntdll.dll");
	const auto set = module == nullptr ? nullptr : reinterpret_cast<set_information>(GetProcAddress(module, "NtSetInformationFile"));
	const auto convert = module == nullptr ? nullptr : reinterpret_cast<status_to_error>(GetProcAddress(module, "RtlNtStatusToDosError"));
	if (set == nullptr || convert == nullptr) { SetLastError(ERROR_PROC_NOT_FOUND); fail("native API admission"); }
	assert_identity(directory.get(), parent_id, true); assert_identity(input.get(), source_id, false);
	if (destination_id) assert_identity(previous.get(), *destination_id, false);
	recapture(parent, parent_id, true); recapture(source, source_id); recapture(destination, destination_id);
	// One handle-based namespace operation: no unlink gap, attribute merge or fallback.
	IO_STATUS_BLOCK completion{};
	const auto status = set(input.get(), &completion, rename, static_cast<ULONG>(size), 65U);
	if (status != 0) { SetLastError(convert(status)); fail("atomic rename"); }
	assert_identity(directory.get(), parent_id, true); assert_identity(input.get(), source_id, false);
	recapture(parent, parent_id, true); recapture(destination, source_id); recapture(source, std::nullopt);
}
#endif
}
void replace_file(std::span<const std::string_view> fields) {
	if (fields.size() != 8) throw std::runtime_error("Unsupported Motion file replacement envelope.");
	const auto source = absolute_path(fields[0]), destination = absolute_path(fields[1]);
	if (source == destination || source.parent_path() != destination.parent_path()) throw std::runtime_error("Motion replacement requires distinct files in the same selected parent.");
	const identity parent{unsigned_id(fields[2]), unsigned_id(fields[3])}, input{unsigned_id(fields[4]), unsigned_id(fields[5])};
	const bool absent = fields[6] == "-" && fields[7] == "-";
	const auto previous = absent ? std::optional<identity>{} : std::optional<identity>{identity{unsigned_id(fields[6]), unsigned_id(fields[7])}};
#ifdef _WIN32
	replace_windows(source, destination, parent, input, previous);
#else
	static_cast<void>(parent); static_cast<void>(input); static_cast<void>(previous);
	throw std::runtime_error("Motion native file replacement is Windows-only; this platform uses its existing POSIX rename.");
#endif
}
}
