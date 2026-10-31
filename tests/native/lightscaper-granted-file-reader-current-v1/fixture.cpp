/* SPDX-License-Identifier: AGPL-3.0-only */

// Test-only control peer. Every root/file/read is the production native owner.
#include "granted_file_reader.hpp"
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <optional>
#include <span>
#include <sstream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#else
#include <sys/stat.h>
#endif

namespace reader = scape::granted_files;
static_assert(!std::is_copy_constructible_v<reader::root_reader>);
static_assert(!std::is_copy_constructible_v<reader::file_reader>);
static_assert(std::is_move_constructible_v<reader::root_reader>);
static_assert(std::is_move_constructible_v<reader::file_reader>);

unsigned digit(char c) {
	if (c >= '0' && c <= '9') return static_cast<unsigned>(c - '0');
	if (c >= 'a' && c <= 'f') return static_cast<unsigned>(c - 'a' + 10);
	throw std::runtime_error("invalid fixture hex");
}
std::string unhex(const std::string& value) {
	if (value == "-") return {};
	if (value.size() % 2 != 0) throw std::runtime_error("invalid fixture hex length");
	std::string result; result.reserve(value.size() / 2);
	for (std::size_t i = 0; i < value.size(); i += 2) result += static_cast<char>((digit(value[i]) << 4U) | digit(value[i + 1]));
	return result;
}
std::string hex(std::span<const std::byte> value) {
	constexpr char digits[] = "0123456789abcdef";
	std::string result; result.reserve(value.size() * 2);
	for (auto byte : value) { const auto v = std::to_integer<unsigned>(byte); result += digits[v >> 4U]; result += digits[v & 15U]; }
	return result.empty() ? "-" : result;
}
std::string hex(const std::string& value) {
	return hex(std::as_bytes(std::span(value.data(), value.size())));
}
std::filesystem::path path(const std::string& value) {
	const auto bytes = unhex(value);
#ifdef _WIN32
	if (bytes.size() % 2 != 0) throw std::runtime_error("invalid fixture UTF16 path");
	std::wstring native;
	for (std::size_t i = 0; i < bytes.size(); i += 2) native += static_cast<wchar_t>(static_cast<unsigned char>(bytes[i]) | (static_cast<unsigned>(static_cast<unsigned char>(bytes[i + 1])) << 8U));
	return std::filesystem::path(native);
#else
	return std::filesystem::path(bytes);
#endif
}
std::string word(std::istringstream& input) { std::string value; if (!(input >> value)) throw std::runtime_error("missing fixture argument"); return value; }
std::uint64_t number(std::istringstream& input) {
	const auto value = word(input); std::size_t used = 0;
	const auto result = std::stoull(value, &used); if (used != value.size()) throw std::runtime_error("bad fixture integer"); return result;
}

int main() {
#ifdef _WIN32
	if (_setmode(_fileno(stdin), _O_BINARY) == -1 || _setmode(_fileno(stdout), _O_BINARY) == -1) return 5;
#endif
	std::optional<reader::root_reader> root;
	std::optional<reader::file_reader> file;
	std::string line;
	while (std::getline(std::cin, line)) {
		if (line.size() > 262144) return 3;
		try {
			std::istringstream input(line); const auto command = word(input);
			if (command == "ROOT") {
				const auto actual = path(word(input)); const auto volume = word(input), object = word(input);
				if (file) { file->close(); file.reset(); }
				if (root) { root->close(); root.reset(); }
				const auto expected = volume == "-" && object == "-" ? std::nullopt
					: std::optional<reader::file_identity>{ reader::file_identity{ unhex(volume), unhex(object) } };
				root.emplace(reader::root_reader::open(actual, expected));
				const auto identity = root->identity();
				std::cout << "ROOT " << hex(identity.volume) << ' ' << hex(identity.object) << '\n';
			} else if (command == "OPEN") {
				if (!root) throw std::runtime_error("fixture has no root");
				const auto count = number(input); if (count > 16) throw std::runtime_error("fixture component cap");
				std::vector<std::filesystem::path> components;
				for (std::uint64_t i = 0; i < count; ++i) components.push_back(path(word(input)));
				if (file) { file->close(); file.reset(); }
				file.emplace(root->open_file(components));
				const auto identity = file->identity();
				std::cout << "FILE " << file->byte_length() << ' ' << hex(identity.volume) << ' ' << hex(identity.object) << '\n';
			} else if (command == "READ") {
				if (!file) throw std::runtime_error("fixture has no file");
				const auto offset = number(input), length = number(input);
				if (length > 1048577) throw std::runtime_error("fixture allocation cap");
				std::vector<std::byte> bytes(static_cast<std::size_t>(length));
				const auto read = file->read_at(offset, bytes);
				if (read > bytes.size()) throw std::runtime_error("fixture read escaped buffer");
				std::cout << "DATA " << hex(std::span(bytes.data(), read)) << '\n';
			} else if (command == "FILE_CLOSE") {
				if (file) { file->close(); }
				std::cout << "CLOSED\n";
			} else if (command == "ROOT_CLOSE") {
				if (root) { root->close(); }
				std::cout << "CLOSED\n";
#ifndef _WIN32
			} else if (command == "FIFO") {
				const auto actual = path(word(input));
				if (::mkfifo(actual.c_str(), 0600) != 0) throw std::runtime_error("fixture mkfifo failed");
				std::cout << "FIFO\n";
#endif
			} else if (command == "CREATE") {
				const auto actual = path(word(input)); const auto bytes = unhex(word(input));
				if (bytes.size() > 4096) throw std::runtime_error("fixture seed cap");
				std::ofstream output(actual, std::ios::binary | std::ios::trunc);
				output.write(bytes.data(), static_cast<std::streamsize>(bytes.size())); output.close();
				if (!output) throw std::runtime_error("fixture seed failed");
				std::cout << "CREATED\n";
			} else if (command == "EXIT") {
				if (file) { file->close(); }
				if (root) { root->close(); }
				std::cout << "BYE\n" << std::flush; return 0;
			} else throw std::runtime_error("unknown fixture operation");
		} catch (const reader::read_error& error) {
			std::cout << "ERROR " << static_cast<unsigned>(error.code()) << '\n';
		} catch (const std::exception&) { std::cout << "FIXTURE_ERROR\n"; }
		std::cout << std::flush;
	}
	try { if (file) { file->close(); } if (root) { root->close(); } } catch (...) { return 4; }
	return 0;
}
