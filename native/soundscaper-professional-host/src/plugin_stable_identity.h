/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <cstdint>
#include <string>

namespace soundscaper {

inline std::string stableJucePluginId(const std::string &format, int32_t nativeId,
	const std::string &name, const std::string &fileOrIdentifier)
{
	// AU's component tuple and LV2's URI are native registry identifiers.
	if (format == "au" || format == "lv2") return fileOrIdentifier.empty() ? std::string() : format + ":" + fileOrIdentifier;
	if (format != "vst2" && format != "vst3" && format != "ladspa") return {};
	// JUCE's general identifier hashes the file path. Every supervised session
	// gets a fresh snapshot path. Use the format's ID instead; for VST3 JUCE
	// supplies a normalized class-ID hash, so retain its name discriminator too.
	constexpr char hex[] = "0123456789abcdef";
	const auto value = static_cast<uint32_t>(nativeId);
	std::string identifier = format + ":00000000";
	for (uint32_t index = 0; index < 8; ++index) {
		identifier[format.size() + 1 + index] = hex[(value >> ((7 - index) * 4)) & 0xf];
	}
	return format == "vst3" ? identifier + ":" + name : identifier;
}

} // namespace soundscaper
