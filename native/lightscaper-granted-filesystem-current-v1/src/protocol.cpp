/* SPDX-License-Identifier: AGPL-3.0-only */
#include "granted_filesystem_protocol.hpp"
#include "granted_file_reader.hpp"
#include <algorithm>
#include <array>
#include <cstring>
#include <iostream>
#include <limits>
#include <unordered_map>

namespace scape::granted_files {
namespace {
using bytes = std::vector<std::byte>;
constexpr std::size_t control_cap = 262144;
#if defined(_WIN32) && (defined(_M_ARM64) || defined(__aarch64__))
constexpr unsigned target = 5;
#elif defined(_WIN32) && (defined(_M_X64) || defined(__x86_64__))
constexpr unsigned target = 4;
#elif defined(__APPLE__) && (defined(__aarch64__) || defined(__arm64__))
constexpr unsigned target = 3;
#elif defined(__linux__) && defined(__aarch64__)
constexpr unsigned target = 2;
#elif defined(__linux__) && defined(__x86_64__)
constexpr unsigned target = 1;
#else
#error Granted filesystem role requires one of the five maintained native targets.
#endif
struct protocol_error final : std::runtime_error { using std::runtime_error::runtime_error; };
struct writer {
	bytes value;
	void number(std::uint64_t number, std::size_t count) { for (std::size_t index = count; index > 0; --index) value.push_back(static_cast<std::byte>(number >> ((index - 1) * 8))); }
	void raw(std::span<const std::byte> data) { value.insert(value.end(), data.begin(), data.end()); }
	void text(const std::string& text) { if (text.size() > 256) throw protocol_error("Identity too long."); number(text.size(), 2); raw(std::as_bytes(std::span(text))); }
	void identity(const file_identity& identity) { text(identity.volume); text(identity.object); }
	void path(const std::filesystem::path& path) {
		const auto& native = path.native();
#ifdef _WIN32
		static_assert(sizeof(wchar_t) == 2); number(2, 1); number(native.size() * 2, 4);
		for (const auto unit : native) { number(static_cast<std::uint16_t>(unit) & 255, 1); number(static_cast<std::uint16_t>(unit) >> 8, 1); }
#else
		number(1, 1); number(native.size(), 4); raw(std::as_bytes(std::span(native)));
#endif
	}
};
struct reader {
	std::span<const std::byte> value;
	std::size_t offset = 0;
	std::span<const std::byte> raw(std::size_t length) {
		if (length > value.size() - offset) throw protocol_error("Truncated field.");
		const auto result = value.subspan(offset, length); offset += length; return result;
	}
	std::uint64_t number(std::size_t count) { std::uint64_t result = 0; for (const auto byte : raw(count)) result = (result << 8) | std::to_integer<unsigned>(byte); return result; }
	std::string id() {
		const auto data = raw(32); if (std::all_of(data.begin(), data.end(), [](std::byte byte) { return byte == std::byte{}; })) throw protocol_error("Zero ID.");
		return std::string(reinterpret_cast<const char*>(data.data()), data.size());
	}
	std::string text() {
		const auto length = number(2); if (!length || length > 256) throw protocol_error("Invalid identity."); const auto data = raw(static_cast<std::size_t>(length));
		for (const auto byte : data) if (byte < std::byte{32} || byte > std::byte{126}) throw protocol_error("Non-ASCII identity.");
		return std::string(reinterpret_cast<const char*>(data.data()), data.size());
	}
	file_identity identity() { auto volume = text(); return { std::move(volume), text() }; }
	std::filesystem::path path(bool root) {
		const auto encoding = number(1), length = number(4);
#ifdef _WIN32
		if (encoding != 2 || length % 2 || length > (root ? 65536U : 8192U)) throw protocol_error("Invalid native UTF16 path.");
		const auto data = raw(static_cast<std::size_t>(length)); std::wstring native; native.reserve(data.size() / 2);
		for (std::size_t index = 0; index < data.size(); index += 2) native.push_back(static_cast<wchar_t>(std::to_integer<unsigned>(data[index]) | (std::to_integer<unsigned>(data[index + 1]) << 8)));
#else
		if (encoding != 1 || length > (root ? 32768U : 4096U)) throw protocol_error("Invalid native byte path.");
		const auto data = raw(static_cast<std::size_t>(length)); std::string native(reinterpret_cast<const char*>(data.data()), data.size());
#endif
		return std::filesystem::path(std::move(native));
	}
	std::vector<std::filesystem::path> components(bool empty) {
		const auto count = number(1); if ((!empty && !count) || count > maximum_components) throw protocol_error("Invalid component count.");
		std::vector<std::filesystem::path> result; result.reserve(static_cast<std::size_t>(count));
		for (std::size_t index = 0; index < count; ++index) result.push_back(path(false));
		return result;
	}
	void end() const { if (offset != value.size()) throw protocol_error("Trailing fields."); }
};
void reply(unsigned opcode, std::uint32_t id, std::span<const std::byte> payload) {
	writer header; header.raw(std::as_bytes(std::span("SGR1", 4))); header.number(1, 1); header.number(opcode, 1); header.number(0, 2); header.number(id, 4); header.number(payload.size(), 4);
	std::cout.write(reinterpret_cast<const char*>(header.value.data()), static_cast<std::streamsize>(header.value.size()));
	if (!payload.empty()) std::cout.write(reinterpret_cast<const char*>(payload.data()), static_cast<std::streamsize>(payload.size()));
	std::cout.flush(); if (!std::cout) throw protocol_error("Pipe write failed.");
}
void error_reply(unsigned phase, std::uint32_t id, unsigned code, std::uint32_t native_code = 0) {
	writer result; result.number(code, 2); result.number(phase, 1); result.number(native_code, 4); result.number(process_retirement_is_unproved() ? 1 : 0, 1);
	constexpr std::string_view diagnostic = "Granted filesystem operation refused.";
	result.number(diagnostic.size(), 2); result.raw(std::as_bytes(std::span(diagnostic))); reply(255, id, result.value);
}
struct peer {
	std::unordered_map<std::string, root_reader> roots;
	std::unordered_map<std::string, file_reader> files;
	std::unordered_map<std::string, directory_reader> scans;
	bool initialized = false;
	void fresh(const std::string& id) const { if (roots.contains(id) || files.contains(id) || scans.contains(id)) throw read_error(error_code::invalid_path, "Native owner ID is already live."); }
	template<class Map> static auto& find(Map& owners, const std::string& id) {
		const auto found = owners.find(id); if (found == owners.end()) throw read_error(error_code::closed, "Native owner ID is absent."); return found->second;
	}
	template<class Map> void close(Map& owners, const std::string& id) {
		const auto found = owners.find(id);
		if (found == owners.end()) { if (roots.contains(id) || files.contains(id) || scans.contains(id)) throw read_error(error_code::invalid_path, "Native owner purpose differs."); return; }
		found->second.close(); owners.erase(found);
	}
	void close_all() {
		std::exception_ptr primary;
		auto attempt = [&primary](auto& owners) { for (auto& entry : owners) { try { entry.second.close(); } catch (...) { if (!primary) primary = std::current_exception(); } } };
		attempt(scans); attempt(files); attempt(roots); if (primary) std::rethrow_exception(primary);
	}
	writer execute(unsigned opcode, reader& input) {
		writer result;
		if (opcode == 1) {
			if (initialized) throw protocol_error("Repeated INIT.");
			const auto nonce = input.raw(32); const auto actual = input.number(1); input.end();
			if (actual != target) throw protocol_error("Target differs.");
			initialized = true; result.raw(nonce); result.number(target, 1);
			result.number(64, 2); result.number(4094, 2); result.number(4, 1); result.number(4, 1); result.number(maximum_read_bytes, 4);
			result.number(control_cap, 4); result.number(64, 2); result.number(65536, 4); return result;
		}
		if (!initialized) throw protocol_error("INIT required.");
		if (opcode == 2) {
			const auto id = input.id(); const auto path = input.path(true); const auto present = input.number(1); if (present > 1) throw protocol_error("Invalid optional identity.");
			const auto expected = present ? std::optional<file_identity>(input.identity()) : std::nullopt; input.end(); fresh(id);
			if (roots.size() >= 64) throw read_error(error_code::invalid_range, "Native root capacity is busy.");
			auto root = root_reader::open(path, expected); result.identity(root.identity()); roots.emplace(id, std::move(root));
		} else if (opcode == 3 || opcode == 6 || opcode == 9) {
			const auto id = input.id(); input.end(); if (opcode == 3) close(roots, id); else if (opcode == 6) close(files, id); else close(scans, id);
		} else if (opcode == 4 || opcode == 7) {
			const auto id = input.id(), parent = input.id(); auto components = input.components(opcode == 7); input.end(); fresh(id);
			auto& root = find(roots, parent);
			if (opcode == 4) {
				if (files.size() >= 4094) throw read_error(error_code::invalid_range, "Native file capacity is busy.");
				auto file = root.open_file(components); result.number(file.byte_length(), 8); result.identity(file.identity()); files.emplace(id, std::move(file));
			} else {
				if (scans.size() >= 4) throw read_error(error_code::invalid_range, "Native scan capacity is busy.");
				auto scan = root.open_directory(components); scans.emplace(id, std::move(scan));
			}
		} else if (opcode == 5) {
			const auto id = input.id(); const auto offset = input.number(8), length = input.number(4); input.end(); auto& file = find(files, id);
			if (!length || length > maximum_read_bytes || offset > file.byte_length() || length > file.byte_length() - offset) throw read_error(error_code::invalid_range, "Native read range is invalid.");
			result.value.resize(static_cast<std::size_t>(length)); file.read_at(offset, result.value);
		} else if (opcode == 8) {
			const auto id = input.id(); input.end(); auto page = find(scans, id).next(); result.number(page.done ? 1 : 0, 1); result.number(page.entries.size(), 2);
			for (const auto& entry : page.entries) {
				result.number(static_cast<unsigned>(entry.kind), 1); result.path(entry.component); result.number(entry.byte_length.value_or(std::numeric_limits<std::uint64_t>::max()), 8);
				result.number(entry.observation ? 1 : 0, 1); if (entry.observation) result.raw(*entry.observation);
				result.number(entry.identity ? 1 : 0, 1); if (entry.identity) result.identity(*entry.identity);
			}
			if (result.value.size() > 65536) throw protocol_error("Native directory page exceeds its bound.");
		} else if (opcode == 10) { input.end(); close_all(); }
		else throw protocol_error("Unknown shipping opcode.");
		return result;
	}
};
}
int run_granted_filesystem() {
	peer owner; std::uint32_t watermark = 0; int status = 0;
	for (;;) {
		std::array<std::byte, 16> header{}; std::cin.read(reinterpret_cast<char*>(header.data()), static_cast<std::streamsize>(header.size()));
		if (std::cin.gcount() == 0 && std::cin.eof()) break;
		reader frame{ header }; unsigned opcode = 0; std::uint32_t id = 0; bool fatal = false;
		try {
			if (std::cin.gcount() != 16 || std::memcmp(header.data(), "SGR1", 4) != 0) throw protocol_error("Invalid frame.");
			(void)frame.raw(4); if (frame.number(1) != 1) throw protocol_error("Invalid frame version."); opcode = static_cast<unsigned>(frame.number(1));
			if (frame.number(2) != 0) throw protocol_error("Invalid reserved fields.");
			id = static_cast<std::uint32_t>(frame.number(4));
			const auto length = frame.number(4); if (!id || id <= watermark) throw protocol_error("Invalid watermark."); watermark = id;
			if (length > control_cap) throw protocol_error("Control frame too large.");
			bytes body(static_cast<std::size_t>(length)); if (!body.empty()) std::cin.read(reinterpret_cast<char*>(body.data()), static_cast<std::streamsize>(body.size()));
			if (!body.empty() && std::cin.gcount() != static_cast<std::streamsize>(body.size())) throw protocol_error("Truncated body.");
			reader input{ body }; auto result = owner.execute(opcode, input); reply(opcode | 128U, id, result.value); if (opcode == 10) break;
		} catch (const protocol_error&) { fatal = true; try { error_reply(opcode, id, 100); } catch (...) {} }
		catch (const read_error& error) {
			try { error_reply(opcode, id, static_cast<unsigned>(error.code()), error.native_code()); } catch (...) { fatal = true; }
			if (opcode == 10) { status = 3; break; }
		}
		catch (...) { fatal = true; try { error_reply(opcode, id, 7); } catch (...) {} }
		if (fatal) { status = 2; break; }
	}
	try { owner.close_all(); } catch (...) { status = 3; }
	return status;
}
} // namespace scape::granted_files
