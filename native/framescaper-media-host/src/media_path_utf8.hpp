// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include <filesystem>
#include <string>

namespace framescaper::media {

[[nodiscard]] inline std::string media_path_utf8(const std::filesystem::path& path) {
	const auto utf8 = path.u8string();
	return {utf8.begin(), utf8.end()};
}

} // namespace framescaper::media
