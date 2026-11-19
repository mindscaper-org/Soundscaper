// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

extern "C" {
#include <libavformat/avformat.h>
#include <libavutil/dict.h>
}

#include <string_view>

namespace framescaper::media {

[[nodiscard]] inline bool webm_vpx_declares_alpha(const AVFormatContext& format, const AVStream& stream) {
	if (format.iformat == nullptr || std::string_view{format.iformat->name} != "matroska,webm") return false;
	const auto codec = stream.codecpar->codec_id;
	if (codec != AV_CODEC_ID_VP8 && codec != AV_CODEC_ID_VP9) return false;
	const auto* alpha = av_dict_get(stream.metadata, "alpha_mode", nullptr, 0);
	return alpha != nullptr && std::string_view{alpha->value} == "1";
}

} // namespace framescaper::media
