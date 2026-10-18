/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

// Read-only native filesystem authority. Paths retain platform-native storage;
// a display string or a structural identity never becomes a renderer grant.
#include <cstddef>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <memory>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace scape::granted_files {

inline constexpr std::size_t maximum_read_bytes = 1024U * 1024U;
inline constexpr std::size_t maximum_components = 16;

struct file_identity final {
	std::string volume;
	std::string object;
	friend bool operator==(const file_identity&, const file_identity&) = default;
};

enum class error_code : unsigned {
	invalid_path = 1, root_identity_mismatch = 2, not_regular = 3,
	identity_changed = 4, invalid_range = 5, closed = 6, io = 7,
	symlink_or_reparse = 8, unsupported_filesystem = 9,
};

class read_error final : public std::runtime_error {
public:
	read_error(error_code code, std::string detail, std::vector<std::exception_ptr> causes = {})
		: std::runtime_error(std::move(detail)), code_(code), causes_(std::move(causes)) {}
	error_code code() const noexcept { return code_; }
	const std::vector<std::exception_ptr>& causes() const noexcept { return causes_; }
private:
	error_code code_;
	std::vector<std::exception_ptr> causes_;
};

class root_reader;

/** An actual fixed file handle; root retirement cannot redirect it. Reads and
 * close serialize on that handle. Only successful explicit close certifies
 * retirement; a close failure is cached and process-quarantines native work. */
class file_reader final {
public:
	file_reader(file_reader&&) noexcept;
	file_reader& operator=(file_reader&&);
	file_reader(const file_reader&) = delete;
	file_reader& operator=(const file_reader&) = delete;
	~file_reader();
	file_identity identity() const;
	std::uint64_t byte_length() const;
	std::size_t read_at(std::uint64_t offset, std::span<std::byte> destination);
	void close();
private:
	struct state;
	explicit file_reader(std::unique_ptr<state>) noexcept;
	std::unique_ptr<state> state_;
	friend class root_reader;
};

/** Main-private trusted selection/reopen primitive. Expected identity checks
 * the actual opened root before any file payload. Every native component is
 * validated before traversal; no write, remove or publication capability. */
class root_reader final {
public:
	static root_reader open(const std::filesystem::path& path,
		std::optional<file_identity> expected = std::nullopt);
	root_reader(root_reader&&) noexcept;
	root_reader& operator=(root_reader&&);
	root_reader(const root_reader&) = delete;
	root_reader& operator=(const root_reader&) = delete;
	~root_reader();
	file_identity identity() const;
	file_reader open_file(std::span<const std::filesystem::path> components);
	void close();
private:
	struct state;
	explicit root_reader(std::unique_ptr<state>) noexcept;
	std::unique_ptr<state> state_;
};

} // namespace scape::granted_files
