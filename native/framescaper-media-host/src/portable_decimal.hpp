/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once

#include <algorithm>
#include <cmath>
#include <locale>
#include <sstream>
#include <string>
#include <string_view>

namespace framescaper::media {

/** Floating from_chars is absent in supported Apple SDKs; keep its strict finite decimal domain. */
[[nodiscard]] inline bool try_read_finite_decimal(const std::string_view text, double& output) {
	if (text.empty() || text.size() > 64 || text.front() == '+') return false;
	std::istringstream stream{std::string{text}};
	stream.imbue(std::locale::classic());
	double parsed{};
	stream >> std::noskipws >> parsed;
	if (stream.fail() || !stream.eof() || !std::isfinite(parsed)) return false;
	// Standard streams may round an out-of-range tiny value to zero silently.
	const auto mantissa = text.substr(0, text.find_first_of("eE"));
	if (parsed == 0 && std::any_of(mantissa.begin(), mantissa.end(), [](const char byte) {
		return byte >= '1' && byte <= '9';
	})) return false;
	output = parsed;
	return true;
}

} // namespace framescaper::media
