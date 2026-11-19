// SPDX-License-Identifier: AGPL-3.0-only

#include "ffmpeg_decode_session.hpp"
#include "professional_source_probe.hpp"

#include <cassert>

int main(const int argc, char** argv) {
	assert(argc == 3);
	assert(framescaper::media::professional_source_characteristics_self_test());
	for (int index = 1; index < argc; ++index) {
		auto session = framescaper::media::ffmpeg_decode_session::open(argv[index], "native-cpu");
		const auto characteristics = framescaper::media::professional_source_characteristics_json(
			*session.format, session.stream_index);
		assert(characteristics.find("\"hasAlpha\":true") != std::string::npos);
		assert(characteristics.find("\"pixelFormat\":\"yuv420p\"") == std::string::npos);
	}
}
