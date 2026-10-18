/* SPDX-License-Identifier: AGPL-3.0-only */

// POSIX handle-relative mechanics shared by Linux and macOS. Derived from the
// maintained delivery_fs_posix/Linux/macOS root-open and regular-file readers.
#include "granted_file_reader.hpp"
#include <array>
#include <cerrno>
#include <charconv>
#include <cstring>
#include <fcntl.h>
#include <mutex>
#include <sys/stat.h>
#include <unistd.h>

namespace scape::granted_files {
namespace {

struct unretired_handle { int descriptor; std::exception_ptr failure; };
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

std::exception_ptr io_failure(const char* phase, int error) {
	return std::make_exception_ptr(read_error(error_code::io,
		std::string("Granted native ") + phase + " failed (errno " + std::to_string(error) + ")."));
}
void assert_process() {
	std::exception_ptr failure;
	{ auto& owner = process_quarantine(); std::lock_guard lock(owner.mutex); failure = owner.failure; }
	if (failure) std::rethrow_exception(failure);
}
void quarantine_close(int descriptor, std::exception_ptr failure) noexcept {
	try {
		auto& owner = process_quarantine(); std::lock_guard lock(owner.mutex);
		owner.handles.push_back({ descriptor, failure });
		if (!owner.failure) owner.failure = failure;
	} catch (...) { std::terminate(); } // Real process exit retires every native handle.
}
void close_once(int& value, std::exception_ptr& failure) {
	if (failure) std::rethrow_exception(failure);
	if (value < 0) return;
	const auto descriptor = std::exchange(value, -1);
	// Never retry EINTR: the descriptor may already have been released/reused.
	if (::close(descriptor) != 0) {
		failure = io_failure("handle close", errno); quarantine_close(descriptor, failure);
		std::rethrow_exception(failure);
	}
}
void close_noexcept(int& value, std::exception_ptr& failure) noexcept {
	try { close_once(value, failure); } catch (...) { /* Cached, strongly quarantined; never retry. */ }
}
struct held_descriptor {
	int value = -1;
	std::exception_ptr failure;
	explicit held_descriptor(int descriptor) noexcept : value(descriptor) {}
	held_descriptor(held_descriptor&& other) noexcept
		: value(std::exchange(other.value, -1)), failure(std::move(other.failure)) {}
	held_descriptor(const held_descriptor&) = delete;
	held_descriptor& operator=(const held_descriptor&) = delete;
	~held_descriptor() { close_noexcept(value, failure); }
	void close() { close_once(value, failure); }
	int release() noexcept { return std::exchange(value, -1); }
};
[[noreturn]] void fail_after_cleanup(std::exception_ptr primary, std::vector<held_descriptor>& held) {
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
file_identity identity_of(const struct stat& value) {
	return { "posix-device:" + hex(static_cast<std::uint64_t>(value.st_dev)),
		"posix-inode:" + hex(static_cast<std::uint64_t>(value.st_ino)) };
}
struct stamp {
	file_identity identity;
	std::uint64_t bytes;
	std::int64_t modified_seconds, modified_nanoseconds, changed_seconds, changed_nanoseconds;
	friend bool operator==(const stamp&, const stamp&) = default;
};
stamp file_stamp(int descriptor) {
	struct stat value{};
	if (::fstat(descriptor, &value) != 0) std::rethrow_exception(io_failure("file stat", errno));
	if (!S_ISREG(value.st_mode) || value.st_size < 0) throw read_error(error_code::not_regular, "Granted native file is not regular.");
#ifdef __APPLE__
	const auto modified = value.st_mtimespec, changed = value.st_ctimespec;
#else
	const auto modified = value.st_mtim, changed = value.st_ctim;
#endif
	return { identity_of(value), static_cast<std::uint64_t>(value.st_size),
		static_cast<std::int64_t>(modified.tv_sec), static_cast<std::int64_t>(modified.tv_nsec),
		static_cast<std::int64_t>(changed.tv_sec), static_cast<std::int64_t>(changed.tv_nsec) };
}
void validate_root(const std::filesystem::path& path) {
	const auto& text = path.native();
	if (text.empty() || text.size() > 32768 || !path.is_absolute() || text.find('\0') != std::string::npos)
		throw read_error(error_code::invalid_path, "Granted native root requires a bounded absolute native path.");
}
void validate_components(std::span<const std::filesystem::path> components) {
	if (components.empty() || components.size() > maximum_components) throw read_error(error_code::invalid_path, "Granted native component count is invalid.");
	for (const auto& component : components) {
		const auto& text = component.native();
		if (text.empty() || text.size() > 4096 || text == "." || text == ".."
			|| text.find('/') != std::string::npos || text.find('\0') != std::string::npos)
			throw read_error(error_code::invalid_path, "Granted native path requires exact relative components.");
	}
}
[[noreturn]] void fail_open(int parent, const char* path, int error, bool directory) {
	struct stat observed{};
	const auto result = parent < 0 ? ::lstat(path, &observed) : ::fstatat(parent, path, &observed, AT_SYMLINK_NOFOLLOW);
	if (error == ELOOP || (result == 0 && S_ISLNK(observed.st_mode)))
		throw read_error(error_code::symlink_or_reparse, "Granted native traversal refuses symbolic links.");
	if (result == 0 && directory && !S_ISDIR(observed.st_mode))
		throw read_error(error_code::not_regular, "Granted native parent is not a directory.");
	std::rethrow_exception(io_failure("relative open", error));
}

} // namespace

struct file_reader::state {
	int descriptor = -1;
	stamp captured;
	std::exception_ptr failure;
	mutable std::mutex mutex;
	explicit state(stamp value) : captured(std::move(value)) {}
	~state() { close_noexcept(descriptor, failure); }
};
struct root_reader::state {
	int descriptor = -1;
	file_identity captured;
	std::exception_ptr failure;
	mutable std::mutex mutex;
	explicit state(file_identity value) : captured(std::move(value)) {}
	~state() { close_noexcept(descriptor, failure); }
};

file_reader::file_reader(std::unique_ptr<state> value) noexcept : state_(std::move(value)) {}
file_reader::file_reader(file_reader&&) noexcept = default;
file_reader& file_reader::operator=(file_reader&& other) {
	if (this != &other) { close(); state_ = std::move(other.state_); } return *this;
}
file_reader::~file_reader() = default;
file_identity file_reader::identity() const {
	if (!state_) throw read_error(error_code::closed, "Granted native file was moved.");
	return state_->captured.identity;
}
std::uint64_t file_reader::byte_length() const {
	if (!state_) throw read_error(error_code::closed, "Granted native file was moved.");
	return state_->captured.bytes;
}
std::size_t file_reader::read_at(std::uint64_t offset, std::span<std::byte> destination) {
	if (!state_) throw read_error(error_code::closed, "Granted native file was moved.");
	std::lock_guard lock(state_->mutex); assert_process();
	if (state_->failure) std::rethrow_exception(state_->failure);
	if (state_->descriptor < 0) throw read_error(error_code::closed, "Granted native file is closed.");
	if (destination.empty() || destination.size() > maximum_read_bytes || offset > state_->captured.bytes
		|| destination.size() > state_->captured.bytes - offset) throw read_error(error_code::invalid_range, "Granted native read exceeds its fixed range.");
	if (file_stamp(state_->descriptor) != state_->captured) throw read_error(error_code::identity_changed, "Granted native file changed before reading.");
	std::size_t completed = 0;
	while (completed < destination.size()) {
		const auto result = ::pread(state_->descriptor, destination.data() + completed, destination.size() - completed,
			static_cast<off_t>(offset + completed));
		if (result < 0) { if (errno == EINTR) continue; std::rethrow_exception(io_failure("file read", errno)); }
		if (result == 0) throw read_error(error_code::identity_changed, "Granted native file ended during reading.");
		completed += static_cast<std::size_t>(result);
	}
	if (file_stamp(state_->descriptor) != state_->captured) throw read_error(error_code::identity_changed, "Granted native file changed during reading.");
	assert_process(); return completed;
}
void file_reader::close() {
	if (!state_) return;
	std::lock_guard lock(state_->mutex); close_once(state_->descriptor, state_->failure);
}

root_reader::root_reader(std::unique_ptr<state> value) noexcept : state_(std::move(value)) {}
root_reader::root_reader(root_reader&&) noexcept = default;
root_reader& root_reader::operator=(root_reader&& other) {
	if (this != &other) { close(); state_ = std::move(other.state_); } return *this;
}
root_reader::~root_reader() = default;
root_reader root_reader::open(const std::filesystem::path& path, std::optional<file_identity> expected) {
	assert_process(); validate_root(path);
	std::vector<held_descriptor> held; held.reserve(1);
	const auto descriptor = ::open(path.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
	if (descriptor < 0) fail_open(-1, path.c_str(), errno, true);
	held.emplace_back(descriptor);
	try {
		struct stat details{};
		if (::fstat(descriptor, &details) != 0) std::rethrow_exception(io_failure("root stat", errno));
		if (!S_ISDIR(details.st_mode)) throw read_error(error_code::not_regular, "Granted native root is not a directory.");
		auto identity = identity_of(details);
		if (expected && *expected != identity) throw read_error(error_code::root_identity_mismatch, "Granted native root identity differs.");
		auto result = std::make_unique<state>(std::move(identity)); result->descriptor = held.back().release();
		return root_reader(std::move(result));
	} catch (...) { fail_after_cleanup(std::current_exception(), held); }
}
file_identity root_reader::identity() const {
	if (!state_) throw read_error(error_code::closed, "Granted native root was moved.");
	return state_->captured;
}
file_reader root_reader::open_file(std::span<const std::filesystem::path> components) {
	if (!state_) throw read_error(error_code::closed, "Granted native root was moved.");
	std::lock_guard lock(state_->mutex); assert_process();
	if (state_->failure) std::rethrow_exception(state_->failure);
	if (state_->descriptor < 0) throw read_error(error_code::closed, "Granted native root is closed.");
	validate_components(components);
	std::vector<held_descriptor> held; held.reserve(components.size());
	try {
		auto parent = state_->descriptor;
		for (std::size_t index = 0; index < components.size(); ++index) {
			const auto directory = index + 1 < components.size();
			const auto flags = O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK | (directory ? O_DIRECTORY : 0);
			const auto descriptor = ::openat(parent, components[index].c_str(), flags);
			if (descriptor < 0) fail_open(parent, components[index].c_str(), errno, directory);
			held.emplace_back(descriptor);
			struct stat details{};
			if (::fstat(descriptor, &details) != 0) std::rethrow_exception(io_failure("component stat", errno));
			if ((directory && !S_ISDIR(details.st_mode)) || (!directory && !S_ISREG(details.st_mode)))
				throw read_error(error_code::not_regular, "Granted native component has the wrong file type.");
			if (identity_of(details).volume != state_->captured.volume)
				throw read_error(error_code::unsupported_filesystem, "Granted native traversal refuses a different mounted volume.");
			parent = descriptor;
		}
		auto result = std::make_unique<file_reader::state>(file_stamp(held.back().value));
		for (std::size_t index = held.size() - 1; index > 0; --index) held[index - 1].close();
		result->descriptor = held.back().release(); return file_reader(std::move(result));
	} catch (...) { fail_after_cleanup(std::current_exception(), held); }
}
void root_reader::close() {
	if (!state_) return;
	std::lock_guard lock(state_->mutex); close_once(state_->descriptor, state_->failure);
}

} // namespace scape::granted_files
