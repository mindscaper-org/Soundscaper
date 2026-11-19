/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include <windows.h>
#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <map>
#include <string>
#include <variant>
#include <vector>

namespace lightscaper::association {
struct Failure { std::string stage; DWORD code; };
inline void require(bool okay, const char *stage) { if (!okay) throw Failure{stage, ERROR_INVALID_DATA}; }
inline void checked(BOOL okay, const char *stage) { if (!okay) throw Failure{stage, GetLastError()}; }
inline std::wstring wide(const std::string &value) {
	require(value.size() <= 32768u, "utf8-size");
	if (value.empty()) return {};
	const int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
	require(count > 0, "utf8-decode"); std::wstring result(static_cast<size_t>(count), L'\0');
	checked(MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), count) == count, "utf8-decode");
	return result;
}
inline std::string utf8(const std::wstring &value) {
	require(value.size() <= 32768u, "utf16-size");
	if (value.empty()) return {};
	const int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
	require(count > 0, "utf16-encode"); std::string result(static_cast<size_t>(count), '\0');
	checked(WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), count, nullptr, nullptr) == count, "utf16-encode");
	return result;
}
inline std::string quote(const std::string &value) {
	std::string result = "\""; const char *digits = "0123456789abcdef";
	for (const unsigned char c : value) {
		if (c == '"' || c == '\\') { result += '\\'; result += static_cast<char>(c); }
		else if (c < 32u) { result += "\\u00"; result += digits[c >> 4u]; result += digits[c & 15u]; }
		else result += static_cast<char>(c);
	}
	return result + '"';
}
inline bool hex(const std::string &value, size_t size) {
	return value.size() == size && value.find_first_not_of("0123456789abcdef") == std::string::npos;
}
using Field = std::variant<std::string, uint64_t>;
class Json {
	const std::string &bytes; size_t at = 0u;
	void space() { while (at < bytes.size() && (bytes[at] == ' ' || bytes[at] == '\n' || bytes[at] == '\r' || bytes[at] == '\t')) ++at; }
	char take() { require(at < bytes.size(), "json-truncated"); return bytes[at++]; }
	unsigned unit() {
		unsigned result = 0u;
		for (unsigned i = 0u; i < 4u; ++i) {
			const char c = take(); const size_t digit = std::string("0123456789abcdef").find(c >= 'A' && c <= 'F' ? static_cast<char>(c + 32) : c);
			require(digit < 16u, "json-unicode"); result = result * 16u + static_cast<unsigned>(digit);
		}
		return result;
	}
	std::string text() {
		require(take() == '"', "json-string"); std::string result;
		for (;;) {
			const unsigned char c = static_cast<unsigned char>(take()); if (c == '"') break;
			require(c >= 32u, "json-control");
			if (c != '\\') result += static_cast<char>(c);
			else {
				const char escaped = take();
				if (escaped == '"' || escaped == '\\' || escaped == '/') result += escaped;
				else if (escaped == 'b') result += '\b'; else if (escaped == 'f') result += '\f';
				else if (escaped == 'n') result += '\n'; else if (escaped == 'r') result += '\r'; else if (escaped == 't') result += '\t';
				else {
					require(escaped == 'u', "json-escape"); const unsigned first = unit(); std::wstring decoded(1u, static_cast<wchar_t>(first));
					if (first >= 0xd800u && first <= 0xdbffu) {
						require(take() == '\\' && take() == 'u', "json-surrogate"); const unsigned second = unit();
						require(second >= 0xdc00u && second <= 0xdfffu, "json-surrogate"); decoded += static_cast<wchar_t>(second);
					} else require(first < 0xdc00u || first > 0xdfffu, "json-surrogate");
					result += utf8(decoded);
				}
			}
			require(result.size() <= 32768u, "json-string-size");
		}
		(void)wide(result); return result;
	}
	uint64_t number() {
		const size_t first = at; uint64_t result = 0u;
		while (at < bytes.size() && bytes[at] >= '0' && bytes[at] <= '9') {
			const uint64_t digit = static_cast<unsigned>(bytes[at++] - '0');
			require(result <= (std::numeric_limits<uint64_t>::max() - digit) / 10u, "json-number"); result = result * 10u + digit;
		}
		require(at > first && (at - first == 1u || bytes[first] != '0'), "json-number"); return result;
	}
public:
	explicit Json(const std::string &input) : bytes(input) { require(bytes.size() <= 65536u, "request-size"); }
	std::map<std::string, Field> object() {
		space(); require(take() == '{', "json-object"); std::map<std::string, Field> fields; space();
		for (;;) {
			require(fields.size() < 9u, "json-fields"); std::string key = text(); space(); require(take() == ':', "json-colon"); space();
			Field value = at < bytes.size() && bytes[at] == '"' ? Field(text()) : Field(number());
			require(fields.emplace(key, value).second, "json-duplicate"); space(); const char next = take();
			if (next == '}') break; require(next == ',', "json-separator"); space();
		}
		space(); require(at == bytes.size(), "json-trailing"); return fields;
	}
};
struct Request { std::string nonce, target, revision, digest; std::wstring executable, archive; DWORD primary = 0u; };
inline Request request(const std::string &bytes) {
	const auto fields = Json(bytes).object();
	const std::array<const char *, 9> names{{"schemaVersion", "nonce", "target", "sourceRevision", "operation", "executablePath", "archivePath", "archiveSha256", "primaryPid"}};
	require(fields.size() == names.size(), "request-fields"); for (const auto name : names) require(fields.count(name) == 1u, "request-field");
	const auto string = [&](const char *name) { const auto value = std::get_if<std::string>(&fields.at(name)); require(value != nullptr && value->find('\0') == std::string::npos, "request-string"); return *value; };
	const auto integer = [&](const char *name) { const auto value = std::get_if<uint64_t>(&fields.at(name)); require(value != nullptr, "request-integer"); return *value; };
	require(integer("schemaVersion") == 1u && string("operation") == "open", "request-version-operation");
	Request value; value.nonce = string("nonce"); value.target = string("target"); value.revision = string("sourceRevision"); value.digest = string("archiveSha256");
	require(hex(value.nonce, 32u) && hex(value.revision, 40u) && hex(value.digest, 64u), "request-identity");
	require(value.target == LIGHTSCAPER_ASSOCIATION_TARGET, "request-target"); const uint64_t pid = integer("primaryPid");
	require(pid > 0u && pid <= std::numeric_limits<DWORD>::max() && pid != GetCurrentProcessId(), "request-primary"); value.primary = static_cast<DWORD>(pid);
	value.executable = wide(string("executablePath")); value.archive = wide(string("archivePath")); return value;
}
}
