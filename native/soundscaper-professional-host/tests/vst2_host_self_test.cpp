/* SPDX-License-Identifier: AGPL-3.0-only */

#include "professional_host_api.h"
#include "juce_message_dispatcher.h"
#include <pluginterfaces/vst2.x/aeffectx.h>
#include <array>
#include <chrono>
#include <cstddef>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <vector>

// JUCE uses sizeof for the original ABI's minimum inline-array allocations.
static_assert(sizeof(VstIntPtr) == sizeof(void *));
static_assert(sizeof(VstSpeakerArrangement) >= offsetof(VstSpeakerArrangement, speakers) + 8 * sizeof(VstSpeakerProperties));
static_assert(sizeof(VstEvents) >= offsetof(VstEvents, events) + 2 * sizeof(void *));
static_assert(sizeof(MidiKeyName) >= offsetof(MidiKeyName, keyName) + 64);
static_assert(sizeof(VstPinProperties) == 128);

#define REQUIRE(expression) do { if (!(expression)) { std::fprintf(stderr, "VST2 check failed at line %d: %s\n", __LINE__, #expression); return 1; } } while (false)

int run(const char *path, const char *format)
{
	size_t count = 0;
	REQUIRE(soundscaper_pro_plugin_scan(format, path, nullptr, 0, &count) == SOUNDSCAPER_PRO_OK);
	REQUIRE(count == 1);
	soundscaper_pro_plugin_description description{};
	REQUIRE(soundscaper_pro_plugin_scan(format, path, &description, 1, &count) == SOUNDSCAPER_PRO_OK);
	REQUIRE(std::strcmp(description.format, format) == 0);
	// VST3 moduleinfo scanning does not instantiate the processor for bus counts.
	if (std::strcmp(format, "vst2") == 0) REQUIRE(description.input_channels == 2 && description.output_channels == 2);
	const auto temporary = std::filesystem::temp_directory_path() / ("soundscaper-vst2-"
		+ std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
	REQUIRE(std::filesystem::create_directory(temporary));
	struct Cleanup {
		std::filesystem::path directory;
		~Cleanup() { std::error_code ignored; std::filesystem::remove_all(directory, ignored); }
	} cleanup{temporary};
	const auto snapshot = temporary / std::filesystem::path(path).filename();
	std::filesystem::copy(path, snapshot, std::filesystem::copy_options::recursive);
	const auto snapshotPath = snapshot.string();
	soundscaper_pro_plugin_description moved{};
	REQUIRE(soundscaper_pro_plugin_scan(format, snapshotPath.c_str(), &moved, 1, &count) == SOUNDSCAPER_PRO_OK);
	REQUIRE(std::strcmp(description.stable_id, moved.stable_id) == 0);
	soundscaper_pro_plugin_instance *instance = nullptr;
	REQUIRE(soundscaper_pro_plugin_open(format, snapshotPath.c_str(), description.stable_id, 48000, 16, &instance) == SOUNDSCAPER_PRO_OK);
	uint32_t inputs = 0, outputs = 0;
	REQUIRE(soundscaper_pro_plugin_audio_topology(instance, &inputs, &outputs) == SOUNDSCAPER_PRO_OK);
	REQUIRE(inputs == 2 && outputs == 2);
	REQUIRE(soundscaper_pro_plugin_audio_topology(nullptr, &inputs, &outputs) == SOUNDSCAPER_PRO_PLUGIN_MALFORMED);
	soundscaper_pro_plugin_capability_report capabilities{};
	REQUIRE(soundscaper_pro_plugin_get_capabilities(instance, &capabilities) == SOUNDSCAPER_PRO_OK);
	REQUIRE(capabilities.parameter_count >= 2 && capabilities.has_vendor_ui == 1);
	std::vector<soundscaper_pro_plugin_parameter> parameters(capabilities.parameter_count);
	size_t parameterCount = 0;
	REQUIRE(soundscaper_pro_plugin_describe_parameters(instance, parameters.data(), parameters.size(), &parameterCount) == SOUNDSCAPER_PRO_OK);
	REQUIRE(parameterCount == parameters.size() && parameters[1].name[0] != '\0');
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
	REQUIRE(soundscaper_pro_plugin_open(format, snapshotPath.c_str(), description.stable_id, 48000, 16, &instance) == SOUNDSCAPER_PRO_OK);
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
	if (argc != 2 && argc != 3) return 2;
	const char *format = argc == 3 ? argv[2] : "vst2";
#if defined(__APPLE__)
	return soundscaper::runMacJuceMessageDispatcher([&]() { return run(argv[1], format); });
#else
	const int result = run(argv[1], format);
	soundscaper::shutdownJuceMessageDispatcher();
	return result;
#endif
}
