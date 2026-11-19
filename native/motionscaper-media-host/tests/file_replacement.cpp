/* SPDX-License-Identifier: AGPL-3.0-only */
#include "../src/file-replacement.hpp"
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>
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
#include <winioctl.h>
#endif

namespace {
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
using fields = std::array<std::string, 8>;
void invoke(const fields& input) {
	std::array<std::string_view, 8> views{};
	for (std::size_t index = 0; index < views.size(); ++index) views[index] = input[index];
	motionscaper::files::replace_file(views);
}
void refuses(const fields& input, const char* message) {
	bool refused = false; try { invoke(input); } catch (const std::exception&) { refused = true; }
	require(refused, message);
}
#ifdef _WIN32
class handle final {
public:
	explicit handle(HANDLE value) : value_(value) {
		if (value == INVALID_HANDLE_VALUE) throw std::runtime_error("Open fixture handle failed (Windows error " + std::to_string(GetLastError()) + ").");
	}
	~handle() { CloseHandle(value_); }
	handle(const handle&) = delete;
	handle& operator=(const handle&) = delete;
	HANDLE get() const noexcept { return value_; }
private:
	HANDLE value_;
};
std::array<std::string, 2> identity(const std::filesystem::path& path) {
	handle file{CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
		nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr)};
	BY_HANDLE_FILE_INFORMATION stat{};
	require(GetFileInformationByHandle(file.get(), &stat) != 0, "Stat fixture identity");
	const auto inode = static_cast<std::uint64_t>(stat.nFileIndexHigh) << 32U | stat.nFileIndexLow;
	return {std::to_string(stat.dwVolumeSerialNumber), std::to_string(inode)};
}
std::string utf8(const std::filesystem::path& path) {
	const auto value = path.u8string(); return {reinterpret_cast<const char*>(value.data()), value.size()};
}
fields grant(const std::filesystem::path& source, const std::filesystem::path& destination, bool absent = false) {
	const auto parent = identity(destination.parent_path()), input = identity(source);
	const auto output = absent ? std::array<std::string, 2>{"-", "-"} : identity(destination);
	return {utf8(source), utf8(destination), parent[0], parent[1], input[0], input[1], output[0], output[1]};
}
void write(const std::filesystem::path& path, const char* body) {
	std::ofstream file{path, std::ios::binary}; file << body; require(file.good(), "Write fixture bytes");
}
std::string read(const std::filesystem::path& path) {
	std::ifstream file{path, std::ios::binary}; require(file.good(), "Read fixture bytes");
	return {std::istreambuf_iterator<char>{file}, std::istreambuf_iterator<char>{}};
}
std::string read_pinned(HANDLE file) {
	LARGE_INTEGER beginning{}; require(SetFilePointerEx(file, beginning, nullptr, FILE_BEGIN) != 0, "Seek pinned fixture");
	std::array<char, 128> bytes{}; DWORD count{};
	require(ReadFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &count, nullptr) != 0, "Read pinned fixture");
	return {bytes.data(), count};
}
void require_unlinked(HANDLE file) {
	BY_HANDLE_FILE_INFORMATION stat{};
	require(GetFileInformationByHandle(file, &stat) != 0 && stat.nNumberOfLinks == 0, "Retained replaced descriptor must report zero links");
}
// Junctions are native NTFS reparse points and do not require symlink privilege.
void junction(const std::filesystem::path& path, const std::filesystem::path& target) {
	require(CreateDirectoryW(path.c_str(), nullptr) != 0, "Create reparse fixture directory");
	handle directory{CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING,
		FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr)};
	auto preferred_target = target;
	preferred_target.make_preferred();
	const std::wstring substitute = L"\\??\\" + preferred_target.native(), print = preferred_target.native();
	struct mount_point { DWORD tag; WORD length; WORD reserved; WORD substitute_offset; WORD substitute_length; WORD print_offset; WORD print_length; };
	const auto path_bytes = (substitute.size() + print.size() + 2) * sizeof(wchar_t);
	std::vector<std::byte> storage(sizeof(mount_point) + path_bytes);
	auto* data = reinterpret_cast<mount_point*>(storage.data());
	data->tag = IO_REPARSE_TAG_MOUNT_POINT;
	data->length = static_cast<WORD>(8 + path_bytes);
	data->substitute_length = static_cast<WORD>(substitute.size() * sizeof(wchar_t));
	data->print_offset = static_cast<WORD>((substitute.size() + 1) * sizeof(wchar_t));
	data->print_length = static_cast<WORD>(print.size() * sizeof(wchar_t));
	auto* names = storage.data() + sizeof(mount_point);
	std::memcpy(names, substitute.c_str(), (substitute.size() + 1) * sizeof(wchar_t));
	std::memcpy(names + data->print_offset, print.c_str(), (print.size() + 1) * sizeof(wchar_t));
	DWORD returned{};
	require(DeviceIoControl(directory.get(), FSCTL_SET_REPARSE_POINT, storage.data(), static_cast<DWORD>(storage.size()),
		nullptr, 0, &returned, nullptr) != 0, "Create native NTFS junction fixture");
}
void windows_cases(const std::filesystem::path& root) {
	const auto source = root / L"candidate-\u00e4.tmp", destination = root / L"selected-\u00e4.mscape";
	write(source, "candidate"); write(destination, "original");
	const auto original_grant = grant(source, destination);
	const auto source_identity = identity(source);
	{
		handle pinned{CreateFileW(destination.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
			nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr)};
		invoke(original_grant);
		require(!std::filesystem::exists(source) && identity(destination) == source_identity && read(destination) == "candidate", "Replacement did not retain the candidate inode/bytes");
		require(read_pinned(pinned.get()) == "original", "Replacement changed the retained original descriptor");
		require_unlinked(pinned.get());
		handle candidate{CreateFileW(destination.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
			nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr)};
		const auto backup = root / "rollback.tmp"; write(backup, "original"); invoke(grant(backup, destination));
		require(read(destination) == "original" && read_pinned(pinned.get()) == "original", "Rollback invalidated retained original bytes");
		require(read_pinned(candidate.get()) == "candidate", "Rollback changed the retained candidate descriptor");
		require_unlinked(pinned.get()); require_unlinked(candidate.get());
	}
	write(source, "new-candidate");
	for (const auto index : {2U, 3U, 4U, 5U, 6U, 7U}) {
		auto bad = grant(source, destination); bad[index] = bad[index] == "0" ? "1" : "0";
		refuses(bad, "A wrong identity was accepted"); require(read(source) == "new-candidate" && read(destination) == "original", "Refusal changed either file");
	}
	for (const auto& invalid : {"", "01", "+1", "-1", "18446744073709551616", "1 "}) {
		auto bad = grant(source, destination); bad[2] = invalid; refuses(bad, "Noncanonical uint64 identity accepted");
	}
	auto malformed = grant(source, destination); malformed[6] = "-"; refuses(malformed, "Unpaired absent identity accepted");
	refuses(grant(source, destination, true), "Absent grant overwrote an existing file");
	const auto absent = root / "absent.mscape"; const auto absent_identity = identity(source);
	invoke(grant(source, absent, true)); require(identity(absent) == absent_identity && read(absent) == "new-candidate", "Absent destination creation changed candidate identity");
	write(source, "last-candidate");
	const auto foreign = root / "foreign"; std::filesystem::create_directory(foreign); write(foreign / "other.mscape", "foreign");
	refuses(grant(source, foreign / "other.mscape"), "Cross-parent replacement accepted");
	auto same = grant(source, destination); same[1] = same[0]; refuses(same, "Same-path replacement accepted");
	const auto alias = root / "alias.tmp"; std::filesystem::create_hard_link(destination, alias);
	refuses(grant(alias, destination), "Same-inode hard-link replacement accepted");
	const auto link = root / "junction"; junction(link, foreign);
	require(read(link / "other.mscape") == "foreign" && identity(link / "other.mscape") == identity(foreign / "other.mscape"), "Native junction fixture must resolve to its expected target before refusal checks");
	refuses(grant(source, link), "Reparse destination accepted");
	refuses(grant(link, destination), "Reparse source accepted");
	write(foreign / "input.tmp", "foreign-candidate");
	refuses(grant(link / "input.tmp", link / "other.mscape"), "Reparse parent accepted");
	require(read(source) == "last-candidate" && read(destination) == "original" && read(foreign / "other.mscape") == "foreign", "Negative cases changed foreign or selected bytes");
	std::filesystem::remove(link);
}
#endif
}
int main(const int argc, char** argv) {
	std::filesystem::path root;
	try {
		require(argc == 2, "Provide a fresh disposable replacement test directory");
		root = std::filesystem::path{reinterpret_cast<const char8_t*>(argv[1])};
		require(root.is_absolute() && std::filesystem::create_directory(root), "Fresh absolute replacement fixture required");
#ifdef _WIN32
		windows_cases(root);
		std::cout << "Motionscaper Windows atomic replacement, retained descriptors and identity refusals passed\n";
#else
		refuses(fields{"/source", "/destination", "0", "0", "0", "0", "-", "-"}, "Windows-only replacement was admitted on this platform");
		std::cout << "Motionscaper non-Windows replacement refusal passed; Windows semantics require native Windows execution\n";
#endif
		std::filesystem::remove_all(root); return 0;
	} catch (const std::exception& error) {
		// Keep a failed fixture for inspection; it is never an accepted native result.
		std::cerr << error.what() << '\n'; return 1;
	}
}
