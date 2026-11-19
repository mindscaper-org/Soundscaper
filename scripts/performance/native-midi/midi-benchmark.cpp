/* SPDX-License-Identifier: AGPL-3.0-only */
#include "professional_host_api.h"
#include "juce_message_dispatcher.h"
#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstdlib>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <vector>

using Clock = std::chrono::steady_clock;
void require(soundscaper_pro_status status) {
	if (status != SOUNDSCAPER_PRO_OK) throw std::runtime_error("Native MIDI host status " + std::to_string(status));
}
double milliseconds(Clock::time_point start) { return std::chrono::duration<double, std::milli>(Clock::now() - start).count(); }

int main(int argc, char **argv) {
	if (argc < 3) return 2;
	try {
		std::ostringstream result;
		const bool wavetable = std::getenv("SOUNDSCAPER_SURGE_WAVETABLE_BENCH") != nullptr;
		result << "{\"sampleRate\":48000,\"patch\":" << std::quoted(wavetable ? "Surge oscillator 1 wavetable" : "upstream default") << ",\"results\":[";
		bool first = true;
		for (int path = 2; path < argc; path++) {
			std::cerr << "Scanning " << argv[path] << '\n';
			soundscaper_pro_plugin_description description{}; size_t count = 0;
			require(soundscaper_pro_plugin_scan("vst3", argv[path], &description, 1, &count));
			if (count != 1 || !description.is_instrument) throw std::runtime_error("Expected one MIDI instrument");
			for (uint32_t frames : {128u, 256u, 1024u}) for (uint32_t voices : {1u, 32u, 128u}) {
				std::cerr << description.name << ": " << frames << " frames, " << voices << " requested voices\n";
				const auto opening = Clock::now();
				soundscaper_pro_plugin_instance *instance = nullptr;
				require(soundscaper_pro_plugin_open("vst3", argv[path], description.stable_id, 48000, frames, &instance));
				const double cold = milliseconds(opening);
				try {
					if (wavetable && std::string(description.name) == "Surge XT") {
						std::vector<soundscaper_pro_plugin_parameter> parameters(4096); size_t written = 0;
						require(soundscaper_pro_plugin_describe_parameters(instance, parameters.data(), parameters.size(), &written));
						bool selected = false;
						for (size_t index = 0; index < written; index++) {
							std::string name = parameters[index].name;
							std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
							if (name.find("osc 1 type") == std::string::npos && name.find("oscillator 1 type") == std::string::npos) continue;
							// Surge's pinned osc_type enum: Wavetable = 2 of the 0..11 choices.
							require(soundscaper_pro_plugin_write_parameter(instance, static_cast<uint32_t>(index), 2.0 / 11.0));
							selected = true; break;
						}
						if (!selected) { for (size_t index = 0; index < written; index++) std::cerr << parameters[index].name << '\n'; throw std::runtime_error("Surge wavetable parameter was not found"); }
					}
					uint32_t inputs = 0, outputs = 0;
					require(soundscaper_pro_plugin_audio_topology(instance, &inputs, &outputs));
					if (inputs > 32 || outputs < 2 || outputs > 32) throw std::runtime_error("Unsupported instrument topology");
					std::vector<std::vector<float>> input(inputs, std::vector<float>(frames)), output(outputs, std::vector<float>(frames));
					std::vector<const float *> inputPlanes; for (const auto &plane : input) inputPlanes.push_back(plane.data());
					std::vector<float *> planes; for (auto &plane : output) planes.push_back(plane.data());
					for (int warm = 0; warm < 4; warm++) require(soundscaper_pro_plugin_process(instance, inputPlanes.data(), inputs, planes.data(), outputs, frames));
					std::vector<soundscaper_pro_midi_event> events;
					for (uint32_t note = 0; note < voices; note++) events.push_back({0, 3, {0x90, static_cast<uint8_t>(36 + note % 72), 100}});
					require(soundscaper_pro_plugin_midi(instance, events.data(), voices, frames));
					std::vector<double> times; double peak = 0, total = 0;
					for (int block = 0; block < 300; block++) {
						const auto start = Clock::now();
						require(soundscaper_pro_plugin_process(instance, inputPlanes.data(), inputs, planes.data(), outputs, frames));
						const auto elapsed = milliseconds(start); times.push_back(elapsed); total += elapsed;
						for (float sample : output[0]) { if (!std::isfinite(sample)) throw std::runtime_error("Non-finite native PCM"); peak = std::max(peak, std::abs(static_cast<double>(sample))); }
					}
					if (peak < 0.0001) throw std::runtime_error("Native synth produced no audible PCM");
					std::sort(times.begin(), times.end());
					if (!first) result << ','; first = false;
					result << "{\"engine\":" << std::quoted(description.name) << ",\"stablePluginId\":" << std::quoted(description.stable_id)
						<< ",\"requestedVoices\":" << voices << ",\"blockFrames\":" << frames << ",\"coldMs\":" << cold
						<< ",\"inputChannels\":" << inputs << ",\"outputChannels\":" << outputs
						<< ",\"p50Ms\":" << times[150] << ",\"p95Ms\":" << times[285] << ",\"p99Ms\":" << times[297]
						<< ",\"deadlineMs\":" << frames / 48.0 << ",\"cpuFraction\":" << total / (300 * frames / 48.0)
						<< ",\"peak\":" << peak << ",\"reportedLatencyFrames\":" << soundscaper_pro_plugin_latency(instance) << '}';
				} catch (...) { soundscaper_pro_plugin_close(instance); throw; }
				soundscaper_pro_plugin_close(instance);
			}
		}
		result << "]}\n";
		std::ofstream output(argv[1]); output << result.str();
		if (!output) throw std::runtime_error("Could not write benchmark report");
		soundscaper::shutdownJuceMessageDispatcher();
		return 0;
	} catch (const std::exception &error) {
		std::cerr << error.what() << '\n'; soundscaper::shutdownJuceMessageDispatcher(); return 1;
	}
}
