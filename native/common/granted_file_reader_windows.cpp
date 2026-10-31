/* SPDX-License-Identifier: AGPL-3.0-only */

// Retained read-only variant of the maintained delivery_fs_windows native
// RootDirectory/NtCreateFile boundary. Native UTF16 never passes through UTF8.
#include "granted_file_reader.hpp"
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <winternl.h>
#include <algorithm>
#include <array>
#include <charconv>
#include <climits>
#include <cstring>
#include <mutex>

namespace scape::granted_files {
namespace {

struct unretired_handle { HANDLE handle; std::exception_ptr failure; };
struct retirement_quarantine {
	std::mutex mutex;
	std::vector<unretired_handle> handles;
	std::exception_ptr failure;
};
retirement_quarantine& process_quarantine() {
	// Deliberately process-lived: unknown actual handles are never retried or
	// released by static-destruction order. The enclosing peer must join exit.
	static auto* const value = new retirement_quarantine;
	return *value;
}

std::exception_ptr io_failure(const char* phase, DWORD error) {
	return std::make_exception_ptr(read_error(error_code::io,
		std::string("Granted native ") + phase + " failed (Windows " + std::to_string(error) + ").",
		std::vector<std::exception_ptr>{}, static_cast<std::uint32_t>(error)));
}
void assert_process() {
	std::exception_ptr failure;
	{ auto& owner = process_quarantine(); std::lock_guard lock(owner.mutex); failure = owner.failure; }
	if (failure) std::rethrow_exception(failure);
}
void quarantine_close(HANDLE handle, std::exception_ptr failure) noexcept {
	try {
		auto& owner = process_quarantine(); std::lock_guard lock(owner.mutex); owner.handles.push_back({ handle, failure });
		if (!owner.failure) owner.failure = failure;
	} catch (...) { std::terminate(); }
}
void close_once(HANDLE& value, std::exception_ptr& failure) {
	if (failure) std::rethrow_exception(failure);
	if (value == INVALID_HANDLE_VALUE) return;
	const auto handle = std::exchange(value, INVALID_HANDLE_VALUE);
	if (!CloseHandle(handle)) {
		failure = io_failure("handle close", GetLastError()); quarantine_close(handle, failure);
		std::rethrow_exception(failure);
	}
}
void close_noexcept(HANDLE& value, std::exception_ptr& failure) noexcept {
	try { close_once(value, failure); } catch (...) { /* Cached native quarantine; never retry. */ }
}
struct held_handle {
	HANDLE value = INVALID_HANDLE_VALUE;
	std::exception_ptr failure;
	explicit held_handle(HANDLE handle) noexcept : value(handle) {}
	held_handle(held_handle&& other) noexcept
		: value(std::exchange(other.value, INVALID_HANDLE_VALUE)), failure(std::move(other.failure)) {}
	held_handle(const held_handle&) = delete;
	held_handle& operator=(const held_handle&) = delete;
	~held_handle() { close_noexcept(value, failure); }
	void close() { close_once(value, failure); }
	HANDLE release() noexcept { return std::exchange(value, INVALID_HANDLE_VALUE); }
};
[[noreturn]] void fail_after_cleanup(std::exception_ptr primary, std::vector<held_handle>& held) {
	std::vector<std::exception_ptr> failures{ primary };
	for (auto entry = held.rbegin(); entry != held.rend(); ++entry) {
		try { entry->close(); } catch (...) { failures.push_back(std::current_exception()); }
	}
	if (failures.size() > 1) throw read_error(error_code::io, "Granted native work and handle retirement failed.", std::move(failures));
	std::rethrow_exception(primary);
}
std::string hex(std::uint64_t value) {
	std::array<char, 16> bytes{};
	const auto converted = std::to_chars(bytes.data(), bytes.data() + bytes.size(), value, 16);
	return std::string(bytes.data(), converted.ptr);
}
DWORD attributes(HANDLE handle) {
	FILE_BASIC_INFO value{};
	if (!GetFileInformationByHandleEx(handle, FileBasicInfo, &value, static_cast<DWORD>(sizeof(value))))
		std::rethrow_exception(io_failure("handle attributes", GetLastError()));
	return value.FileAttributes;
}
file_identity identity_of(HANDLE handle) {
	FILE_ID_INFO value{};
	if (!GetFileInformationByHandleEx(handle, FileIdInfo, &value, static_cast<DWORD>(sizeof(value))))
		throw read_error(error_code::unsupported_filesystem, "Granted native filesystem lacks lossless handle identity.");
	constexpr char digits[] = "0123456789abcdef";
	std::string object; object.reserve(32);
	for (const auto byte : value.FileId.Identifier) { object += digits[byte >> 4U]; object += digits[byte & 15U]; }
	return { "windows-volume:" + hex(value.VolumeSerialNumber), "windows-fileid:" + object };
}
struct stamp {
	file_identity identity;
	std::uint64_t bytes;
	LONGLONG modified, changed;
	DWORD flags;
	friend bool operator==(const stamp&, const stamp&) = default;
};
stamp file_stamp(HANDLE handle) {
	if (GetFileType(handle) != FILE_TYPE_DISK) throw read_error(error_code::not_regular, "Granted native file is not a disk file.");
	FILE_BASIC_INFO basic{}; FILE_STANDARD_INFO standard{};
	if (!GetFileInformationByHandleEx(handle, FileBasicInfo, &basic, static_cast<DWORD>(sizeof(basic)))
		|| !GetFileInformationByHandleEx(handle, FileStandardInfo, &standard, static_cast<DWORD>(sizeof(standard))))
		std::rethrow_exception(io_failure("file stat", GetLastError()));
	if ((basic.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
		throw read_error(error_code::symlink_or_reparse, "Granted native traversal refuses reparse points.");
	if (standard.Directory || (basic.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0 || standard.EndOfFile.QuadPart < 0)
		throw read_error(error_code::not_regular, "Granted native file is not regular.");
	return { identity_of(handle), static_cast<std::uint64_t>(standard.EndOfFile.QuadPart),
		basic.LastWriteTime.QuadPart, basic.ChangeTime.QuadPart, basic.FileAttributes };
}
void validate_root(const std::filesystem::path& path) {
	const auto& text = path.native();
	if (text.empty() || text.size() > 32768 || !path.is_absolute() || text.find(L'\0') != std::wstring::npos)
		throw read_error(error_code::invalid_path, "Granted native root requires a bounded absolute native path.");
}
std::wstring native_root_path(const std::filesystem::path& path) {
	auto value = path.native();
	std::replace(value.begin(), value.end(), L'/', L'\\');
	if (value.starts_with(L"\\\\?\\")) return value;
	if (value.starts_with(L"\\\\.\\")) throw read_error(error_code::invalid_path, "Granted native root cannot be a Win32 device path.");
	if (value.starts_with(L"\\\\")) return L"\\\\?\\UNC\\" + value.substr(2);
	return L"\\\\?\\" + value;
}
void validate_components(std::span<const std::filesystem::path> components, bool allow_empty = false) {
	if ((!allow_empty && components.empty()) || components.size() > maximum_components) throw read_error(error_code::invalid_path, "Granted native component count is invalid.");
	for (const auto& component : components) {
		const auto& text = component.native();
		if (text.empty() || text.size() > 4096 || text == L"." || text == L".."
			|| text.find_first_of(L"\\/:") != std::wstring::npos || text.find(L'\0') != std::wstring::npos)
			throw read_error(error_code::invalid_path, "Granted native path requires exact relative components.");
	}
}
using nt_create_file = NTSTATUS (NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES,
	PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
using rtl_status_to_error = ULONG (WINAPI*)(NTSTATUS);
template<typename Function> Function procedure(const char* name) {
	const auto module = GetModuleHandleW(L"ntdll.dll");
	if (!module) throw read_error(error_code::unsupported_filesystem, "Granted native filesystem API is unavailable.");
	const auto address = GetProcAddress(module, name);
	if (!address) throw read_error(error_code::unsupported_filesystem, "Granted native relative filesystem API is unavailable.");
	Function result{}; static_assert(sizeof(result) == sizeof(address));
	std::memcpy(&result, &address, sizeof(result)); return result;
}
HANDLE open_relative(HANDLE root, const std::filesystem::path& component) {
	const auto create = procedure<nt_create_file>("NtCreateFile");
	const auto convert = procedure<rtl_status_to_error>("RtlNtStatusToDosError");
	const auto& text = component.native();
	UNICODE_STRING name{};
	name.Buffer = const_cast<PWSTR>(text.data());
	name.Length = static_cast<USHORT>(text.size() * sizeof(wchar_t)); name.MaximumLength = name.Length;
	OBJECT_ATTRIBUTES object{};
	InitializeObjectAttributes(&object, &name, OBJ_CASE_INSENSITIVE, root, nullptr);
	IO_STATUS_BLOCK result{}; HANDLE handle = INVALID_HANDLE_VALUE;
	const auto status = create(&handle, FILE_GENERIC_READ | SYNCHRONIZE, &object, &result, nullptr,
		FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_OPEN,
		FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT, nullptr, 0);
	if (status < 0) std::rethrow_exception(io_failure("relative open", convert(status)));
	if (handle == INVALID_HANDLE_VALUE || handle == nullptr) throw read_error(error_code::io, "Granted native open returned no actual handle.");
	return handle;
}
void require_directory(HANDLE handle) {
	const auto flags = attributes(handle);
	if ((flags & FILE_ATTRIBUTE_REPARSE_POINT) != 0) throw read_error(error_code::symlink_or_reparse, "Granted native traversal refuses reparse points.");
	if ((flags & FILE_ATTRIBUTE_DIRECTORY) == 0) throw read_error(error_code::not_regular, "Granted native parent is not a directory.");
}

} // namespace

struct file_reader::state {
	HANDLE handle = INVALID_HANDLE_VALUE;
	stamp captured;
	std::exception_ptr failure;
	mutable std::mutex mutex;
	explicit state(stamp value) : captured(std::move(value)) {}
	~state() { close_noexcept(handle, failure); }
};
struct root_reader::state {
	HANDLE handle = INVALID_HANDLE_VALUE;
	file_identity captured;
	std::exception_ptr failure;
	mutable std::mutex mutex;
	explicit state(file_identity value) : captured(std::move(value)) {}
	~state() { close_noexcept(handle, failure); }
};
file_reader::file_reader(std::unique_ptr<state> value) noexcept : state_(std::move(value)) {}
file_reader::file_reader(file_reader&&) noexcept = default;
file_reader& file_reader::operator=(file_reader&& other) {
	if (this != &other) { close(); state_ = std::move(other.state_); } return *this;
}
file_reader::~file_reader() = default;
file_identity file_reader::identity() const {
	if (!state_) throw read_error(error_code::closed, "Granted native file was moved."); return state_->captured.identity;
}
std::uint64_t file_reader::byte_length() const {
	if (!state_) throw read_error(error_code::closed, "Granted native file was moved."); return state_->captured.bytes;
}
std::size_t file_reader::read_at(std::uint64_t offset, std::span<std::byte> destination) {
	if (!state_) throw read_error(error_code::closed, "Granted native file was moved.");
	std::lock_guard lock(state_->mutex); assert_process();
	if (state_->failure) std::rethrow_exception(state_->failure);
	if (state_->handle == INVALID_HANDLE_VALUE) throw read_error(error_code::closed, "Granted native file is closed.");
	if (destination.empty() || destination.size() > maximum_read_bytes || offset > state_->captured.bytes
		|| destination.size() > state_->captured.bytes - offset) throw read_error(error_code::invalid_range, "Granted native read exceeds its fixed range.");
	if (file_stamp(state_->handle) != state_->captured) throw read_error(error_code::identity_changed, "Granted native file changed before reading.");
	LARGE_INTEGER position{}; position.QuadPart = static_cast<LONGLONG>(offset);
	if (!SetFilePointerEx(state_->handle, position, nullptr, FILE_BEGIN)) std::rethrow_exception(io_failure("file seek", GetLastError()));
	std::size_t completed = 0;
	while (completed < destination.size()) {
		DWORD count = 0;
		if (!ReadFile(state_->handle, destination.data() + completed, static_cast<DWORD>(destination.size() - completed), &count, nullptr))
			std::rethrow_exception(io_failure("file read", GetLastError()));
		if (!count) throw read_error(error_code::identity_changed, "Granted native file ended during reading.");
		completed += count;
	}
	if (file_stamp(state_->handle) != state_->captured) throw read_error(error_code::identity_changed, "Granted native file changed during reading.");
	assert_process(); return completed;
}
void file_reader::close() {
	if (!state_) return;
	std::lock_guard lock(state_->mutex); close_once(state_->handle, state_->failure);
}
root_reader::root_reader(std::unique_ptr<state> value) noexcept : state_(std::move(value)) {}
root_reader::root_reader(root_reader&&) noexcept = default;
root_reader& root_reader::operator=(root_reader&& other) {
	if (this != &other) { close(); state_ = std::move(other.state_); } return *this;
}
root_reader::~root_reader() = default;
root_reader root_reader::open(const std::filesystem::path& path, std::optional<file_identity> expected) {
	assert_process(); validate_root(path);
	std::vector<held_handle> held; held.reserve(1);
	const auto native = native_root_path(path);
	const auto handle = CreateFileW(native.c_str(), FILE_GENERIC_READ | SYNCHRONIZE,
		FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
		FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
	if (handle == INVALID_HANDLE_VALUE) std::rethrow_exception(io_failure("root open", GetLastError()));
	held.emplace_back(handle);
	try {
		require_directory(handle); auto identity = identity_of(handle);
		if (expected && *expected != identity) throw read_error(error_code::root_identity_mismatch, "Granted native root identity differs.");
		auto result = std::make_unique<state>(std::move(identity)); result->handle = held.back().release();
		return root_reader(std::move(result));
	} catch (...) { fail_after_cleanup(std::current_exception(), held); }
}
file_identity root_reader::identity() const {
	if (!state_) throw read_error(error_code::closed, "Granted native root was moved."); return state_->captured;
}
file_reader root_reader::open_file(std::span<const std::filesystem::path> components) {
	if (!state_) throw read_error(error_code::closed, "Granted native root was moved.");
	std::lock_guard lock(state_->mutex); assert_process();
	if (state_->failure) std::rethrow_exception(state_->failure);
	if (state_->handle == INVALID_HANDLE_VALUE) throw read_error(error_code::closed, "Granted native root is closed.");
	validate_components(components); std::vector<held_handle> held; held.reserve(components.size());
	try {
		auto parent = state_->handle;
		for (std::size_t index = 0; index < components.size(); ++index) {
			const auto handle = open_relative(parent, components[index]); held.emplace_back(handle);
			if (index + 1 < components.size()) require_directory(handle);
			else { const auto flags = attributes(handle);
				if ((flags & FILE_ATTRIBUTE_REPARSE_POINT) != 0) throw read_error(error_code::symlink_or_reparse, "Granted native traversal refuses reparse points.");
				if ((flags & FILE_ATTRIBUTE_DIRECTORY) != 0) throw read_error(error_code::not_regular, "Granted native file is not regular."); }
			if (identity_of(handle).volume != state_->captured.volume)
				throw read_error(error_code::unsupported_filesystem, "Granted native traversal refuses a different mounted volume.");
			parent = handle;
		}
		auto result = std::make_unique<file_reader::state>(file_stamp(held.back().value));
		for (std::size_t index = held.size() - 1; index > 0; --index) held[index - 1].close();
		result->handle = held.back().release(); return file_reader(std::move(result));
	} catch (...) { fail_after_cleanup(std::current_exception(), held); }
}
void root_reader::close() {
	if (!state_) return;
	std::lock_guard lock(state_->mutex); close_once(state_->handle, state_->failure);
}

bool process_retirement_is_unproved() noexcept {
	auto& owner = process_quarantine(); std::lock_guard lock(owner.mutex); return static_cast<bool>(owner.failure);
}
struct directory_reader::state {
	HANDLE handle = INVALID_HANDLE_VALUE;
	std::exception_ptr failure;
	file_identity directory_identity;
	alignas(FILE_ID_EXTD_DIR_INFO) std::array<std::byte, 65536> buffer{};
	std::size_t offset = 0;
	bool buffered = false, done = false;
	std::optional<directory_entry> pending;
	std::mutex mutex;
	~state() { close_noexcept(handle, failure); }
};
directory_reader::directory_reader(std::unique_ptr<state> value) noexcept : state_(std::move(value)) {}
directory_reader::directory_reader(directory_reader&&) noexcept = default;
directory_reader& directory_reader::operator=(directory_reader&& other) { if (this != &other) { close(); state_ = std::move(other.state_); } return *this; }
directory_reader::~directory_reader() = default;
namespace {
std::size_t entry_size(const directory_entry& value) {
	return 1 + 1 + 4 + value.component.native().size() * sizeof(wchar_t) + 8 + 1 + (value.observation ? 16 : 0) + 1
		+ (value.identity ? 4 + value.identity->volume.size() + value.identity->object.size() : 0);
}
void store_hint(std::array<std::byte, 16>& output, std::size_t start, std::uint64_t value) {
	for (std::size_t index = 0; index < 8; ++index) output[start + index] = static_cast<std::byte>(value >> ((7 - index) * 8));
}
directory_entry observe(const FILE_ID_EXTD_DIR_INFO& value, const file_identity& directory) {
	directory_entry result; result.component = std::filesystem::path(std::wstring(value.FileName, value.FileNameLength / sizeof(wchar_t)));
	result.kind = (value.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ? directory_kind::link
		: (value.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0 ? directory_kind::directory : directory_kind::file;
	if (result.kind == directory_kind::file && value.EndOfFile.QuadPart >= 0) result.byte_length = static_cast<std::uint64_t>(value.EndOfFile.QuadPart);
	std::array<std::byte, 16> hint{};
	store_hint(hint, 0, static_cast<std::uint64_t>(value.LastWriteTime.QuadPart)); store_hint(hint, 8, static_cast<std::uint64_t>(value.ChangeTime.QuadPart));
	result.observation = hint;
	constexpr char digits[] = "0123456789abcdef"; std::string id; id.reserve(32);
	for (const auto byte : value.FileId.Identifier) { id += digits[byte >> 4U]; id += digits[byte & 15U]; }
	result.identity = file_identity{ directory.volume, "windows-fileid:" + id }; return result;
}
}
directory_page directory_reader::next() {
	if (!state_) throw read_error(error_code::closed, "Granted native directory was moved.");
	std::lock_guard lock(state_->mutex); assert_process();
	if (state_->failure) std::rethrow_exception(state_->failure);
	if (state_->handle == INVALID_HANDLE_VALUE) throw read_error(error_code::closed, "Granted native directory is closed.");
	directory_page result; std::size_t bytes = 3;
	while (!state_->done && result.entries.size() < 64) {
		std::optional<directory_entry> entry = std::move(state_->pending); state_->pending.reset();
		if (!entry) {
			if (!state_->buffered) {
				state_->buffer.fill(std::byte{});
				if (!GetFileInformationByHandleEx(state_->handle, FileIdExtdDirectoryInfo, state_->buffer.data(), static_cast<DWORD>(state_->buffer.size()))) {
					const auto code = GetLastError(); if (code == ERROR_NO_MORE_FILES) { state_->done = true; break; }
					if (code == ERROR_INVALID_PARAMETER || code == ERROR_NOT_SUPPORTED) throw read_error(error_code::unsupported_filesystem, "Granted native directory information is unavailable.");
					std::rethrow_exception(io_failure("directory enumeration", code));
				}
				state_->buffered = true; state_->offset = 0;
			}
			constexpr auto header = offsetof(FILE_ID_EXTD_DIR_INFO, FileName);
			if (state_->offset > state_->buffer.size() - header) throw read_error(error_code::io, "Granted native directory header is invalid.");
			const auto* native = reinterpret_cast<const FILE_ID_EXTD_DIR_INFO*>(state_->buffer.data() + state_->offset);
			if (native->FileNameLength % sizeof(wchar_t) != 0 || native->FileNameLength > 4096 * sizeof(wchar_t)
				|| native->FileNameLength > state_->buffer.size() - state_->offset - header)
				throw read_error(error_code::io, "Granted native directory name is invalid.");
			entry = observe(*native, state_->directory_identity);
			if (native->NextEntryOffset == 0) state_->buffered = false;
			else {
				if (native->NextEntryOffset < header + native->FileNameLength || native->NextEntryOffset % alignof(FILE_ID_EXTD_DIR_INFO) != 0
					|| native->NextEntryOffset > state_->buffer.size() - state_->offset - header)
					throw read_error(error_code::io, "Granted native directory cursor is invalid.");
				state_->offset += native->NextEntryOffset;
			}
			const auto& name = entry->component.native(); if (name == L"." || name == L"..") continue;
		}
		const auto length = entry_size(*entry);
		if (length > 65536 - 3) throw read_error(error_code::invalid_path, "Granted native directory entry exceeds its page.");
		if (length > 65536 - bytes) { state_->pending = std::move(entry); break; }
		bytes += length; result.entries.push_back(std::move(*entry));
	}
	result.done = state_->done && !state_->pending; assert_process(); return result;
}
void directory_reader::close() { if (state_) { std::lock_guard lock(state_->mutex); close_once(state_->handle, state_->failure); } }
directory_reader root_reader::open_directory(std::span<const std::filesystem::path> components) {
	if (!state_) throw read_error(error_code::closed, "Granted native root was moved.");
	std::lock_guard lock(state_->mutex); assert_process();
	if (state_->failure) std::rethrow_exception(state_->failure);
	if (state_->handle == INVALID_HANDLE_VALUE) throw read_error(error_code::closed, "Granted native root is closed.");
	validate_components(components, true); std::vector<held_handle> held; held.reserve(components.size() + 1);
	try {
		auto parent = state_->handle;
		if (components.empty()) {
			const auto handle = open_relative(parent, std::filesystem::path{});
			held.emplace_back(handle); require_directory(handle);
			if (identity_of(handle) != state_->captured) throw read_error(error_code::identity_changed, "Granted native directory clone differs.");
		}
		for (const auto& component : components) {
			const auto handle = open_relative(parent, component); held.emplace_back(handle); require_directory(handle);
			if (identity_of(handle).volume != state_->captured.volume) throw read_error(error_code::unsupported_filesystem, "Granted native directory crosses its root volume.");
			parent = handle;
		}
		auto result = std::make_unique<directory_reader::state>(); result->directory_identity = identity_of(held.back().value);
		for (std::size_t index = held.size() - 1; index > 0; --index) held[index - 1].close();
		result->handle = held.back().release(); return directory_reader(std::move(result));
	} catch (...) { fail_after_cleanup(std::current_exception(), held); }
}

} // namespace scape::granted_files
