/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <algorithm>
#include <string_view>

namespace framescaper::media {

struct webm_encode_settings final {
	bool realtime{};
	int speed{};
	int crf{};
	int tile_columns{};
	unsigned int threads{};
	bool lossless_alpha{};
};

/** Portable runtime tuning: no frame dropping, resizing, or host-specific CPU baseline. */
[[nodiscard]] inline webm_encode_settings webm_settings(
	const std::string_view encoder,
	const std::string_view quality,
	const int width,
	const bool alpha,
	const unsigned int hardware_threads
) {
	const bool draft = quality == "draft";
	const bool high = quality == "high";
	int columns = 0;
	while (columns < 3 && (256 << (columns + 1)) <= width) ++columns;
	return {
		draft,
		encoder == "libsvtav1" ? (draft ? 11 : high ? 6 : 8)
			: draft ? 8 : high ? 2 : 4,
		alpha ? 0 : encoder == "libvpx" ? (draft ? 36 : high ? 12 : 24)
			: draft ? 36 : high ? 24 : 31,
		columns,
		std::clamp(hardware_threads, 1U, 8U),
		alpha,
	};
}

} // namespace framescaper::media
