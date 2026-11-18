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

namespace {

void verify_chromium_vp8_alpha(const std::filesystem::path& path) {
	auto decoder = framescaper::media::ffmpeg_decode_session::open(path, "native-cpu");
	int frame_count = 0;
	// A Chromium canvas recording with opaque, translucent and transparent regions.
	decoder.decode_all([&](AVFrame* frame) {
		assert(frame->width == 64 && frame->height == 32);
		assert(frame->format == AV_PIX_FMT_YUVA420P && frame->data[3] != nullptr);
		const auto* alpha = frame->data[3] + 16 * frame->linesize[3];
		assert(alpha[8] == 255 && alpha[28] >= 126 && alpha[28] <= 130 && alpha[52] == 0);
		++frame_count;
	});
	assert(frame_count == 4);
}

} // namespace

int main(const int argc, char** argv) {
	assert(argc == 3);
	verify_chromium_vp8_alpha(argv[2]);
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
