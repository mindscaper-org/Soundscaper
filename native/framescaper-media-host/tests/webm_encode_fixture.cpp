/* SPDX-License-Identifier: AGPL-3.0-only */

#include "ffmpeg_hardware_encode.hpp"
#include "ffmpeg_decode_session.hpp"
#include "webm_encode_settings.hpp"
#include "keyed_webm_verifier.hpp"
#include "sha256.hpp"

extern "C" {
#include <libavformat/avformat.h>
#include <libavutil/dict.h>
}

#include <array>
#include <cassert>
#include <filesystem>
#include <iostream>
#include <vector>

using namespace framescaper::media;

namespace framescaper::media {
bool test_cancelled = false;
bool media_cancellation_requested() noexcept { return test_cancelled; }
}

namespace {

void check(const int result) {
	if (result < 0) throw std::runtime_error("WebM canary failed: " + std::to_string(result));
}

void encode(const std::filesystem::path& path, const char* encoder, const bool alpha) {
	admitted_media_plan plan;
	plan.container = "webm"; plan.video_encoder = encoder; plan.quality = "draft";
	plan.video_codec = std::string_view{encoder} == "libvpx" ? "vp8"
		: std::string_view{encoder} == "libsvtav1" ? "av1" : "vp9";
	plan.pixel_format = alpha ? "yuva420p" : "yuv420p";
	plan.width = 64; plan.height = 64; plan.output_frame_count = 4;
	plan.professional_profile_id = alpha ? "encode-webm-vp9-alpha" : "encode-webm-" + plan.video_codec;
	keyed_webm_verifier verifier{plan, path.parent_path()};
	auto binding = ffmpeg_video_encode_session::open({plan, "native-cpu", 64, 64, {1, 25}, {25, 1}, true});
	if (plan.video_codec == "vp8") assert(binding->context()->bit_rate > 0);
	AVFormatContext* format = nullptr;
	check(avformat_alloc_output_context2(&format, nullptr, "webm", nullptr));
	AVPacket* packet = av_packet_alloc();
	assert(format != nullptr && packet != nullptr);
	try {
		auto* stream = avformat_new_stream(format, nullptr);
		assert(stream != nullptr);
		stream->time_base = binding->context()->time_base;
		stream->avg_frame_rate = binding->context()->framerate;
		stream->r_frame_rate = binding->context()->framerate;
		check(avcodec_parameters_from_context(stream->codecpar, binding->context()));
		check(avio_open(&format->pb, path.string().c_str(), AVIO_FLAG_WRITE));
		check(avformat_write_header(format, nullptr));
		int packets = 0;
		const auto drain = [&] {
			while (true) {
				const auto result = avcodec_receive_packet(binding->context(), packet);
				if (result == AVERROR(EAGAIN) || result == AVERROR_EOF) break;
				check(result);
				av_packet_rescale_ts(packet, binding->context()->time_base, stream->time_base);
				packet->stream_index = stream->index;
				check(av_interleaved_write_frame(format, packet));
				av_packet_unref(packet); ++packets;
			}
		};
		std::vector<std::uint8_t> rgba(64 * 64 * 4);
		for (int ordinal = 0; ordinal < 4; ++ordinal) {
			for (std::size_t pixel = 0; pixel < rgba.size() / 4; ++pixel) {
				rgba[pixel * 4] = static_cast<std::uint8_t>(pixel + static_cast<std::size_t>(ordinal));
				rgba[pixel * 4 + 1] = 90; rgba[pixel * 4 + 2] = 40;
				rgba[pixel * 4 + 3] = static_cast<std::uint8_t>(pixel % 256);
			}
			const std::array<const std::uint8_t*, 4> planes{rgba.data(), nullptr, nullptr, nullptr};
			verifier.capture({static_cast<std::uint64_t>(ordinal), 0, rgba});
			const std::array<int, 4> strides{64 * 4, 0, 0, 0};
			auto* frame = binding->prepare(planes.data(), strides.data(), 64, 64, AV_PIX_FMT_RGBA, ordinal, 1);
			if (alpha) for (int y = 0; y < 64; ++y) for (int x = 0; x < 64; ++x) {
				assert(frame->data[3][y * frame->linesize[3] + x] == (y * 64 + x) % 256);
			}
			check(avcodec_send_frame(binding->context(), frame)); drain();
		}
		check(avcodec_send_frame(binding->context(), nullptr)); drain();
		assert(packets == 4);
		check(av_write_trailer(format));
		check(avio_closep(&format->pb));
		avformat_free_context(format); format = nullptr;
		av_packet_free(&packet);
		verifier.verify(path, sha256_file(path));
		if (alpha) {
			assert(std::filesystem::file_size(path.parent_path() / "keyed-video-inspection.json") > 0);
			std::filesystem::remove(path.parent_path() / "keyed-video-inspection.json");
		}
		AVFormatContext* inspection = nullptr;
		check(avformat_open_input(&inspection, path.string().c_str(), nullptr, nullptr));
		check(avformat_find_stream_info(inspection, nullptr));
		assert(inspection->nb_streams == 1);
		const auto* video = inspection->streams[0]->codecpar;
		assert(video->width == 64 && video->height == 64);
		assert(video->codec_id == (plan.video_codec == "av1" ? AV_CODEC_ID_AV1
			: plan.video_codec == "vp8" ? AV_CODEC_ID_VP8 : AV_CODEC_ID_VP9));
		if (alpha) {
			const auto* tag = av_dict_get(inspection->streams[0]->metadata, "alpha_mode", nullptr, 0);
			assert(tag != nullptr && std::string_view{tag->value} == "1");
		}
		avformat_close_input(&inspection);
		if (plan.video_codec != "av1") {
			auto decoder = ffmpeg_decode_session::open(path, "native-cpu");
			int decoded = 0;
			decoder.decode_all([&](const AVFrame* frame) {
				assert(frame->width == 64 && frame->height == 64);
				assert(frame->best_effort_timestamp == decoded * 40);
				if (alpha) {
					assert(frame->format == AV_PIX_FMT_YUVA420P);
					for (int y = 0; y < 64; ++y) for (int x = 0; x < 64; ++x) {
						assert(frame->data[3][y * frame->linesize[3] + x] == (y * 64 + x) % 256);
					}
				}
				++decoded;
			});
			assert(decoded == 4);
		}
	} catch (...) {
		if (format != nullptr) { if (format->pb != nullptr) avio_closep(&format->pb); avformat_free_context(format); }
		av_packet_free(&packet); std::filesystem::remove(path); throw;
	}
	std::filesystem::remove(path);
}

} // namespace

int main(const int argc, char** argv) {
	assert(argc == 2);
	const auto fast = webm_settings("libsvtav1", "draft", 1920, false, 128);
	const auto high = webm_settings("libsvtav1", "high", 1920, false, 128);
	assert(fast.speed == 11 && high.speed == 6 && fast.threads == 8);
	assert(webm_settings("libvpx-vp9", "draft", 64, false, 0).threads == 1);
	for (const auto* encoder : {"libvpx", "libvpx-vp9", "libsvtav1"}) {
		encode(std::filesystem::path{argv[1]} / (std::string{encoder} + "-canary.webm"), encoder, false);
	}
	encode(std::filesystem::path{argv[1]} / "vp9-alpha-canary.webm", "libvpx-vp9", true);
	admitted_media_plan cancelled_plan;
	cancelled_plan.professional_profile_id = "encode-webm-vp9-alpha";
	keyed_webm_verifier cancelled{cancelled_plan, argv[1]};
	test_cancelled = true;
	bool refused = false;
	try { cancelled.verify("unused.webm", ""); }
	catch (const selected_v20_execution_error& error) { refused = error.code() == selected_v20_execution_error_code::cancelled; }
	test_cancelled = false;
	assert(refused);
	std::cout << "VP8, VP9, AV1 WebM and exact VP9 alpha passed.\n";
}
