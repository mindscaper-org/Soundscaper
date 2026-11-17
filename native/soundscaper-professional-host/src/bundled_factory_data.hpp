/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include <string>
#include <string_view>
#include <filesystem>
#include <cstdlib>

namespace soundscaper {
inline bool configureBundledFactoryData(std::string_view argument) {
	constexpr std::string_view prefix = "--bundled-surge-data-hex=";
	if (argument.substr(0, prefix.size()) != prefix) return false;
	const auto encoded = argument.substr(prefix.size());
	if (encoded.empty() || encoded.size() > 8192 || encoded.size() % 2) return false;
	std::string path;
	const auto digit = [](char value) { return value >= '0' && value <= '9' ? value - '0' : value >= 'a' && value <= 'f' ? value - 'a' + 10 : -1; };
	for (size_t index = 0; index < encoded.size(); index += 2) {
		const int high = digit(encoded[index]), low = digit(encoded[index + 1]);
		if (high < 0 || low < 0 || (high == 0 && low == 0)) return false;
		path += static_cast<char>(high * 16 + low);
	}
	try {
		const auto directory = std::filesystem::path(std::u8string(path.begin(), path.end()));
		std::error_code error;
		if (!directory.is_absolute() || !std::filesystem::is_directory(directory, error) || error) return false;
#ifdef _WIN32
		return _wputenv_s(L"SURGE_DATA_HOME", directory.c_str()) == 0;
#else
		return setenv("SURGE_DATA_HOME", path.c_str(), 1) == 0;
#endif
	} catch (...) { return false; }
}
}
