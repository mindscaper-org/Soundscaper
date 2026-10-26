// SPDX-License-Identifier: AGPL-3.0-only

#include "ffmpeg_decode_session.hpp"
#include "ffmpeg_decoded_frame_scaler.hpp"

extern "C" {
#include <libavutil/imgutils.h>
}

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <vector>

int main(const int argc, char** argv) {
	assert(argc == 2);
	auto decoder = framescaper::media::ffmpeg_decode_session::open(argv[1], "native-cpu");
	constexpr int width = 1280;
	constexpr int height = 720;
	assert(decoder.codec->width == width && decoder.codec->height == height);
	// Matroska probing through the default VP9 decoder cannot discover BlockAdditional alpha.
	assert(decoder.codec->pix_fmt == AV_PIX_FMT_YUV420P);
	framescaper::media::decoded_frame_scaler scaler{width, height, width, height, AV_PIX_FMT_RGBA};
	std::vector<std::uint8_t> rgba(static_cast<std::size_t>(width * height * 4));
	std::array<std::uint8_t*, 4> planes{};
	std::array<int, 4> strides{};
	assert(av_image_fill_arrays(planes.data(), strides.data(), rgba.data(), AV_PIX_FMT_RGBA,
		width, height, 1) > 0);
	int frame_count = 0;
	decoder.decode_all([&](AVFrame* frame) {
		assert(frame->format == AV_PIX_FMT_YUVA420P);
		scaler.scale(*frame, planes.data(), strides.data());
		for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x) {
			const auto expected = x < 400 ? 255 : x < 800 ? 128 : 0;
			assert(rgba[static_cast<std::size_t>((y * width + x) * 4 + 3)] == expected);
		}
		for (const bool change_geometry : {false, true}) {
			auto changed = *frame;
			if (change_geometry) --changed.width; else changed.format = AV_PIX_FMT_YUV420P;
			bool rejected = false;
			try { scaler.scale(changed, planes.data(), strides.data()); }
			catch (const framescaper::media::ffmpeg_decode_failure& error) {
				rejected = error.code() == "decode-format-change";
			}
			assert(rejected);
		}
		++frame_count;
	});
	assert(frame_count == 4);
}
