/* SPDX-License-Identifier: AGPL-3.0-only */

#include "keyed_webm_verifier.hpp"
#include "ffmpeg_decode_session.hpp"
#include "ffmpeg_media_engine.hpp"
#include "sha256.hpp"

extern "C" {
#include <libavutil/dict.h>
#include <libavutil/pixfmt.h>
}

#include <cstdio>
#include <algorithm>
#include <iomanip>
#include <sstream>
#include <utility>

namespace framescaper::media {
namespace {
[[noreturn]] void invalid() { throw std::runtime_error("Native VP9 alpha verification failed."); }
void not_cancelled() {
	if (media_cancellation_requested()) throw selected_v20_execution_error(
		selected_v20_execution_error_code::cancelled, "Native VP9 alpha verification was cancelled.");
}
} // namespace

keyed_webm_verifier::keyed_webm_verifier(const admitted_media_plan& plan, std::filesystem::path scratch)
	: plan_{plan}, scratch_{std::move(scratch)} {}

void keyed_webm_verifier::capture(const selected_v20_output_frame& frame) {
	if (plan_.professional_profile_id != "encode-webm-vp9-alpha") return;
	not_cancelled();
	std::vector<std::uint8_t> alpha(frame.rgba.size() / 4);
	for (std::size_t pixel = 0; pixel < alpha.size(); ++pixel) alpha[pixel] = frame.rgba[pixel * 4 + 3];
	alpha_.push_back(sha256_bytes(alpha.data(), alpha.size()));
}

void keyed_webm_verifier::verify(const std::filesystem::path& output, const std::string& sha256) const {
	if (plan_.professional_profile_id != "encode-webm-vp9-alpha") return;
	not_cancelled();
	auto decoder = ffmpeg_decode_session::open(output, "native-cpu");
	const auto* stream = decoder.format->streams[decoder.stream_index];
	const auto* alpha_mode = av_dict_get(stream->metadata, "alpha_mode", nullptr, 0);
	if (decoder.format->nb_streams != (plan_.includes_audio ? 2U : 1U) || stream->codecpar->codec_id != AV_CODEC_ID_VP9
		|| alpha_mode == nullptr || std::string_view{alpha_mode->value} != "1"
		|| decoder.codec->width != static_cast<int>(plan_.width)
		|| decoder.codec->height != static_cast<int>(plan_.height)
		|| decoder.format->duration <= 0 || stream->time_base.num <= 0 || stream->time_base.den <= 0) invalid();
	std::ostringstream packets;
	std::size_t ordinal = 0;
	decoder.decode_all([&](const AVFrame* frame) {
		not_cancelled();
		if (ordinal >= alpha_.size() || frame->format != AV_PIX_FMT_YUVA420P
			|| frame->width != static_cast<int>(plan_.width) || frame->height != static_cast<int>(plan_.height)
			|| frame->best_effort_timestamp < 0 || frame->duration <= 0) invalid();
		std::vector<std::uint8_t> plane(static_cast<std::size_t>(frame->width) * frame->height);
		for (int row = 0; row < frame->height; ++row) {
			std::copy_n(frame->data[3] + static_cast<std::ptrdiff_t>(row) * frame->linesize[3],
				frame->width, plane.data() + static_cast<std::size_t>(row) * frame->width);
		}
		if (sha256_bytes(plane.data(), plane.size()) != alpha_[ordinal]) invalid();
		if (ordinal != 0) packets << ',';
		packets << "{\"pts\":\"" << frame->best_effort_timestamp
			<< "\",\"duration\":\"" << frame->duration << "\"}";
		++ordinal;
	});
	if (ordinal != alpha_.size() || ordinal != plan_.output_frame_count) invalid();
	std::ostringstream report;
	report << "{\"outputSha256\":\"" << sha256 << "\",\"probe\":{\"streams\":[{"
		<< "\"codec_type\":\"video\",\"codec_name\":\"vp9\",\"width\":" << plan_.width
		<< ",\"height\":" << plan_.height << ",\"tags\":{\"alpha_mode\":\"1\"},\"time_base\":\""
		<< stream->time_base.num << '/' << stream->time_base.den << "\",\"r_frame_rate\":\""
		<< stream->r_frame_rate.num << '/' << stream->r_frame_rate.den << "\"}],\"packets\":["
		<< packets.str() << "],\"format\":{\"duration\":\"" << std::fixed << std::setprecision(6)
		<< static_cast<double>(decoder.format->duration) / AV_TIME_BASE << "\"}}}";
	const auto bytes = report.str();
	if (bytes.size() > 128U * 1024U * 1024U) invalid();
	const auto path = scratch_ / "keyed-video-inspection.json";
	std::FILE* file = nullptr;
#if defined(_WIN32)
	if (_wfopen_s(&file, path.c_str(), L"wbxN") != 0) invalid();
#else
	file = std::fopen(path.c_str(), "wbx");
#endif
	if (file == nullptr) invalid();
	const bool written = std::fwrite(bytes.data(), 1, bytes.size(), file) == bytes.size();
	const bool closed = std::fclose(file) == 0;
	if (!written || !closed) invalid();
}

} // namespace framescaper::media
