/* SPDX-License-Identifier: AGPL-3.0-only */

#include "professional_host_api.h"
#include "juce_message_dispatcher.h"
#include <pluginterfaces/vst2.x/aeffectx.h>
#include <array>
#include <cstddef>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

// JUCE uses sizeof for the original ABI's minimum inline-array allocations.
static_assert(sizeof(VstSpeakerArrangement) >= offsetof(VstSpeakerArrangement, speakers) + 8 * sizeof(VstSpeakerProperties));
static_assert(sizeof(VstEvents) >= offsetof(VstEvents, events) + 2 * sizeof(void *));
static_assert(sizeof(MidiKeyName) >= offsetof(MidiKeyName, keyName) + 64);
static_assert(sizeof(VstPinProperties) == 128);

#define REQUIRE(expression) do { if (!(expression)) { std::fprintf(stderr, "VST2 check failed at line %d: %s\n", __LINE__, #expression); return 1; } } while (false)

int run(const char *path)
{
	size_t count = 0;
	REQUIRE(soundscaper_pro_plugin_scan("vst2", path, nullptr, 0, &count) == SOUNDSCAPER_PRO_OK);
	REQUIRE(count == 1);
	soundscaper_pro_plugin_description description{};
	REQUIRE(soundscaper_pro_plugin_scan("vst2", path, &description, 1, &count) == SOUNDSCAPER_PRO_OK);
	REQUIRE(std::strcmp(description.format, "vst2") == 0);
	REQUIRE(description.input_channels == 2 && description.output_channels == 2);
	soundscaper_pro_plugin_instance *instance = nullptr;
	REQUIRE(soundscaper_pro_plugin_open("vst2", path, description.stable_id, 48000, 16, &instance) == SOUNDSCAPER_PRO_OK);
	soundscaper_pro_plugin_capability_report capabilities{};
	REQUIRE(soundscaper_pro_plugin_get_capabilities(instance, &capabilities) == SOUNDSCAPER_PRO_OK);
	REQUIRE(capabilities.parameter_count == 1 && capabilities.has_vendor_ui == 1);
	REQUIRE(soundscaper_pro_plugin_ara_supported(instance) == 0);
	REQUIRE(soundscaper_pro_plugin_latency(instance) == 8);
	REQUIRE(soundscaper_pro_plugin_write_parameter(instance, 0, 0.25) == SOUNDSCAPER_PRO_OK);
	std::array<float, 16> left{1, -2, 3, -4}, right{2, 4, -2, -4}, outLeft{}, outRight{};
	for (size_t offset = 0; offset < left.size(); offset += 4) {
		const float *inputs[]{left.data() + offset, right.data() + offset};
		float *outputs[]{outLeft.data() + offset, outRight.data() + offset};
		REQUIRE(soundscaper_pro_plugin_process(instance, inputs, 2, outputs, 2, 4) == SOUNDSCAPER_PRO_OK);
	}
	REQUIRE(outLeft[0] == 0 && outRight[0] == 0);
	REQUIRE(std::abs(outLeft[8] - 0.25F) < 0.0001F && std::abs(outRight[9] - 1.0F) < 0.0001F);
	size_t length = 0;
	REQUIRE(soundscaper_pro_plugin_save_state(instance, nullptr, 0, &length) == SOUNDSCAPER_PRO_STATE_TOO_LARGE);
	std::vector<uint8_t> state(length);
	REQUIRE(soundscaper_pro_plugin_save_state(instance, state.data(), state.size(), &length) == SOUNDSCAPER_PRO_OK);
	soundscaper_pro_plugin_close(instance);
	// Recreate the instance to prove an opaque state survives a process/session replacement.
	REQUIRE(soundscaper_pro_plugin_open("vst2", path, description.stable_id, 48000, 16, &instance) == SOUNDSCAPER_PRO_OK);
	REQUIRE(soundscaper_pro_plugin_load_state(instance, state.data(), state.size()) == SOUNDSCAPER_PRO_OK);
	double restored = 0;
	REQUIRE(soundscaper_pro_plugin_read_parameter(instance, 0, &restored) == SOUNDSCAPER_PRO_OK);
	REQUIRE(std::abs(restored - 0.25) < 0.0001);
	soundscaper_pro_plugin_close(instance);
	std::puts("{\"status\":\"passed\",\"canary\":\"vst2-effect-round-trip\"}");
	return 0;
}

int main(int argc, char **argv)
{
	if (argc != 2) return 2;
#if defined(__APPLE__)
	return soundscaper::runMacJuceMessageDispatcher([&]() { return run(argv[1]); });
#else
	const int result = run(argv[1]);
	soundscaper::shutdownJuceMessageDispatcher();
	return result;
#endif
}
