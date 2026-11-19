/* SPDX-License-Identifier: AGPL-3.0-only */
#include "professional_host_api.h"
#include "bundled_factory_data.hpp"
#include "juce_message_dispatcher.h"
#include <array>
#include <cmath>
#include <cstdio>

#define REQUIRE(expression) do { if (!(expression)) { std::fprintf(stderr, "MIDI check failed at line %d: %s\n", __LINE__, #expression); return 1; } } while (false)
int run(const char *path, const char *format)
{
	soundscaper_pro_plugin_description description{};
	size_t count = 0;
	REQUIRE(soundscaper_pro_plugin_scan(format, path, &description, 1, &count) == SOUNDSCAPER_PRO_OK);
	REQUIRE(count == 1 && description.is_instrument == 1);
	soundscaper_pro_plugin_instance *instance = nullptr;
	REQUIRE(soundscaper_pro_plugin_open(format, path, description.stable_id, 48000, 16, &instance) == SOUNDSCAPER_PRO_OK);
	uint32_t inputs = 99, outputs = 0;
	REQUIRE(soundscaper_pro_plugin_audio_topology(instance, &inputs, &outputs) == SOUNDSCAPER_PRO_OK);
	REQUIRE(inputs == 0 && outputs == 2);
	const soundscaper_pro_midi_event events[]{{1, 3, {0x94, 60, 100}}, {3, 3, {0x84, 60, 42}}};
	REQUIRE(soundscaper_pro_plugin_midi(instance, events, 2, 4) == SOUNDSCAPER_PRO_OK);
	std::array<float, 4> left{}, right{};
	float *planes[]{left.data(), right.data()};
	REQUIRE(soundscaper_pro_plugin_process(instance, nullptr, 0, planes, 2, 4) == SOUNDSCAPER_PRO_OK);
	REQUIRE(left[0] == 0 && std::abs(left[1] - 100.0f / 127.0f) < 0.001f && left[2] > 0 && left[3] == 0);
	REQUIRE(left == right);
	REQUIRE(soundscaper_pro_plugin_process(instance, nullptr, 0, planes, 2, 4) == SOUNDSCAPER_PRO_OK);
	REQUIRE(left[0] == 0 && left[1] == 0 && left[2] == 0 && left[3] == 0);
	const soundscaper_pro_midi_event invalid{4, 3, {0x90, 60, 100}};
	REQUIRE(soundscaper_pro_plugin_midi(instance, &invalid, 1, 4) == SOUNDSCAPER_PRO_FORMAT_REFUSED);
	soundscaper_pro_plugin_close(instance);
	return 0;
}
int main(int argc, char **argv)
{
	if (argc != 3) return 2;
	for (const auto argument : {"--wrong-option=00", "--bundled-surge-data-hex=", "--bundled-surge-data-hex=0",
		"--bundled-surge-data-hex=zz", "--bundled-surge-data-hex=00", "--bundled-surge-data-hex=72656c6174697665"})
		REQUIRE(!soundscaper::configureBundledFactoryData(argument));
	const auto dataPath = std::filesystem::current_path().u8string();
	std::string encoded;
	for (const unsigned char byte : dataPath) { encoded += "0123456789abcdef"[byte >> 4]; encoded += "0123456789abcdef"[byte & 15]; }
	REQUIRE(soundscaper::configureBundledFactoryData("--bundled-surge-data-hex=" + encoded));
#ifdef _WIN32
	REQUIRE(std::filesystem::path(_wgetenv(L"SURGE_DATA_HOME")) == std::filesystem::current_path());
#else
	REQUIRE(std::string(std::getenv("SURGE_DATA_HOME")) == std::string(dataPath.begin(), dataPath.end()));
#endif
#if defined(__APPLE__)
	return soundscaper::runMacJuceMessageDispatcher([&]() { return run(argv[1], argv[2]); });
#else
	const int result = run(argv[1], argv[2]);
	soundscaper::shutdownJuceMessageDispatcher();
	return result;
#endif
}
