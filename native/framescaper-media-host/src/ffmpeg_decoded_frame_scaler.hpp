// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include "ffmpeg_decode_session.hpp"

extern "C" {
#include <libswscale/swscale.h>
}

#include <cstdint>

namespace framescaper::media {

/** Decoder context formats can change on the first packet, including VP9 alpha and hardware downloads. */
class decoded_frame_scaler final {
public:
	decoded_frame_scaler(const int source_width, const int source_height, const int output_width,
		const int output_height, const AVPixelFormat output_format)
		: source_width_{source_width}, source_height_{source_height}, output_width_{output_width},
		  output_height_{output_height}, output_format_{output_format} {}
	decoded_frame_scaler(const decoded_frame_scaler&) = delete;
	decoded_frame_scaler& operator=(const decoded_frame_scaler&) = delete;
	~decoded_frame_scaler() { sws_freeContext(context_); }

	void scale(const AVFrame& frame, std::uint8_t* const output[], const int output_strides[]) {
		if (frame.width != source_width_ || frame.height != source_height_
			|| frame.format == AV_PIX_FMT_NONE
			|| (context_ != nullptr && frame.format != input_format_)) {
			throw ffmpeg_decode_failure("decode-format-change",
				"Mid-stream video geometry or pixel format changes are not in this decode subset.", 78);
		}
		if (context_ == nullptr) {
			input_format_ = static_cast<AVPixelFormat>(frame.format);
			context_ = sws_getContext(frame.width, frame.height, input_format_, output_width_,
				output_height_, output_format_, SWS_BICUBIC, nullptr, nullptr, nullptr);
			if (context_ == nullptr) {
				throw ffmpeg_decode_failure("decode-scale", "The decoded-frame conversion cannot be created.");
			}
		}
		if (sws_scale(context_, frame.data, frame.linesize, 0, frame.height, output, output_strides)
			!= output_height_) {
			throw ffmpeg_decode_failure("decode-scale", "The decoded-frame conversion did not produce its full raster.");
		}
	}

private:
	const int source_width_;
	const int source_height_;
	const int output_width_;
	const int output_height_;
	const AVPixelFormat output_format_;
	AVPixelFormat input_format_{AV_PIX_FMT_NONE};
	SwsContext* context_{};
};

} // namespace framescaper::media
