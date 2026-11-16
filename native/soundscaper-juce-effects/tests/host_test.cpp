/* SPDX-License-Identifier: AGPL-3.0-only */
#include "professional_host_api.h"
#include "juce_message_dispatcher.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <vector>

void require(bool value, const char *message) { if (!value) throw std::runtime_error(message); }
std::vector<uint8_t> reverbState()
{
	// Independently encode the published SJE1 format rather than using the processor writer.
	std::vector<uint8_t> bytes;
	const auto integer = [&](uint32_t value) { for (int i = 0; i < 4; ++i) bytes.push_back(static_cast<uint8_t>(value >> (i * 8))); };
	const auto sample = [&](float value) { uint32_t bits = 0; std::memcpy(&bits, &value, 4); integer(bits); };
	integer(0x534a4531); integer(2); sample(1); sample(0); sample(60.0f / 72.0f);
	uint64_t rate = 0; const double sampleRate = 48000; std::memcpy(&rate, &sampleRate, 8);
	integer(static_cast<uint32_t>(rate)); integer(static_cast<uint32_t>(rate >> 32));
	integer(2); integer(600); integer(0);
	for (int channel = 0; channel < 2; ++channel) for (int frame = 0; frame < 600; ++frame)
		sample(channel == 0 ? frame == 0 ? 0.5f : frame == 300 ? 0.25f : 0
			: frame == 0 ? -0.5f : frame == 511 ? 0.125f : 0);
	return bytes;
}
int exercise(const char *path, bool gui)
{
	size_t count = 0;
	require(soundscaper_pro_plugin_scan("clap", path, nullptr, 0, &count) == SOUNDSCAPER_PRO_OK && count == 2, "scan bundled effects");
	soundscaper_pro_plugin_instance *raw = nullptr;
	require(soundscaper_pro_plugin_open("clap", path, "org.soundscaper.juce.gain", 48000, 256, &raw) == SOUNDSCAPER_PRO_OK, "open gain");
	struct Close { soundscaper_pro_plugin_instance *value; ~Close() { soundscaper_pro_plugin_close(value); } } guard{raw};
	soundscaper_pro_plugin_capability_report capabilities{};
	require(soundscaper_pro_plugin_get_capabilities(raw, &capabilities) == SOUNDSCAPER_PRO_OK
		&& capabilities.parameter_count == 1 && capabilities.has_vendor_ui == 1, "host capabilities");
	std::array<soundscaper_pro_plugin_parameter, 1> parameters{};
	require(soundscaper_pro_plugin_describe_parameters(raw, parameters.data(), 1, &count) == SOUNDSCAPER_PRO_OK && count == 1, "host parameters");
	require(soundscaper_pro_plugin_write_parameter(raw, 0, 0.5) == SOUNDSCAPER_PRO_OK, "parameter write");
	double value = 0;
	require(soundscaper_pro_plugin_read_parameter(raw, 0, &value) == SOUNDSCAPER_PRO_OK && value == 0.5, "parameter read");
	size_t length = 0;
	require(soundscaper_pro_plugin_save_state(raw, nullptr, 0, &length) == SOUNDSCAPER_PRO_STATE_TOO_LARGE && length > 0, "state length");
	std::vector<uint8_t> state(length);
	require(soundscaper_pro_plugin_save_state(raw, state.data(), state.size(), &length) == SOUNDSCAPER_PRO_OK, "state save");
	require(soundscaper_pro_plugin_write_parameter(raw, 0, 1) == SOUNDSCAPER_PRO_OK, "change gain");
	require(soundscaper_pro_plugin_load_state(raw, state.data(), state.size()) == SOUNDSCAPER_PRO_OK, "state restore");
	std::array<float, 17> left{}, right{}, outLeft{}, outRight{};
	left.fill(1); right.fill(-1);
	const float *input[]{left.data(), right.data()}; float *output[]{outLeft.data(), outRight.data()};
	require(soundscaper_pro_plugin_process(raw, input, 2, output, 2, 17) == SOUNDSCAPER_PRO_OK, "native process");
	const float expected = std::pow(10.0f, -24.0f / 20.0f);
	require(std::abs(outLeft[0] - expected) < 1e-6f && std::abs(outRight[16] + expected) < 1e-6f, "restored native gain PCM");
	if (gui) {
		require(soundscaper_pro_plugin_open_vendor_window(raw, "juce-gain-test") == SOUNDSCAPER_PRO_OK, "open native editor");
		soundscaper_pro_plugin_close_vendor_window(raw);
		require(soundscaper_pro_plugin_open_vendor_window(raw, "juce-gain-reopen") == SOUNDSCAPER_PRO_OK, "reopen native editor");
		soundscaper_pro_plugin_close_vendor_window(raw);
	}
	soundscaper_pro_plugin_instance *reverb = nullptr;
	require(soundscaper_pro_plugin_open("clap", path, "org.soundscaper.juce.convolution", 48000, 256, &reverb)
		== SOUNDSCAPER_PRO_OK, "open convolution");
	Close reverbGuard{reverb};
	require(soundscaper_pro_plugin_get_capabilities(reverb, &capabilities) == SOUNDSCAPER_PRO_OK
		&& capabilities.parameter_count == 3, "convolution controls");
	const auto irState = reverbState();
	require(soundscaper_pro_plugin_load_state(reverb, irState.data(), irState.size()) == SOUNDSCAPER_PRO_OK,
		"restore embedded convolution before native rendering");
	for (int offset = 0; offset < 600; offset += 17) {
		left.fill(0); right.fill(0);
		if (offset == 0) { left[0] = 1; right[0] = 1; }
		const auto frames = static_cast<uint32_t>(std::min(17, 600 - offset));
		require(soundscaper_pro_plugin_process(reverb, input, 2, output, 2, frames) == SOUNDSCAPER_PRO_OK, "native convolution tail");
		for (uint32_t frame = 0; frame < frames; ++frame) {
			const int absolute = offset + static_cast<int>(frame);
			require(std::abs(outLeft[frame] - (absolute == 0 ? 0.5f : absolute == 300 ? 0.25f : 0)) < 1e-5f, "native left IR");
			require(std::abs(outRight[frame] - (absolute == 0 ? -0.5f : absolute == 511 ? 0.125f : 0)) < 1e-5f, "native right IR");
		}
	}
	if (gui) {
		require(soundscaper_pro_plugin_open_vendor_window(reverb, "juce-reverb-test") == SOUNDSCAPER_PRO_OK, "open convolution editor");
		soundscaper_pro_plugin_close_vendor_window(reverb);
	}
	std::cout << "Bundled CLAP scan, controls, state and short-block PCM passed\n";
	return 0;
}
int main(int argc, char **argv)
{
	if (argc < 2 || argc > 3) return 1;
	auto run = [&]() { try { return exercise(argv[1], argc == 3); } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; } };
#if defined(__APPLE__)
	return soundscaper::runMacJuceMessageDispatcher(run);
#else
	return run();
#endif
}
