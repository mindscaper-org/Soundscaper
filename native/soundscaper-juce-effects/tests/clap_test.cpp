/* SPDX-License-Identifier: AGPL-3.0-only */
#include <juce_core/juce_core.h>
#include <clap/clap.h>
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>

void require(bool value, const char *message) { if (!value) throw std::runtime_error(message); }
int main(int argc, char **argv)
{
	try {
		require(argc == 2, "library path");
		juce::DynamicLibrary library;
		require(library.open(juce::String(argv[1])), "load CLAP");
		const auto *entry = static_cast<const clap_plugin_entry_t *>(library.getFunction("clap_entry"));
		require(entry && entry->init(argv[1]), "CLAP entry");
		const auto *factory = static_cast<const clap_plugin_factory_t *>(entry->get_factory(CLAP_PLUGIN_FACTORY_ID));
		require(factory && factory->get_plugin_count(factory) == 2, "CLAP factory");
		clap_host_t host{}; host.clap_version = CLAP_VERSION;
		const auto *plugin = factory->create_plugin(factory, &host, "org.soundscaper.juce.gain");
		require(plugin && plugin->init(plugin) && plugin->activate(plugin, 48000, 1, 128)
			&& plugin->start_processing(plugin), "activate");
		struct Guard {
			const clap_plugin_t *plugin; const clap_plugin_entry_t *entry;
			~Guard() { plugin->stop_processing(plugin); plugin->deactivate(plugin); plugin->destroy(plugin); entry->deinit(); }
		} guard{plugin, entry};
		std::array<float, 17> left, right;
		left.fill(1); right.fill(1);
		float *planes[]{left.data(), right.data()};
		clap_audio_buffer_t input{}, output{};
		input.data32 = planes; output.data32 = planes; input.channel_count = output.channel_count = 2;
		clap_event_param_value_t event{};
		event.header = {sizeof(event), 8, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE, 0};
		event.param_id = 0; event.value = 0;
		clap_input_events_t events{&event,
			[](const clap_input_events_t *) -> uint32_t { return 1; },
			[](const clap_input_events_t *events, uint32_t) -> const clap_event_header_t * {
				return &static_cast<const clap_event_param_value_t *>(events->ctx)->header;
			}};
		clap_process_t process{};
		process.frames_count = 17; process.audio_inputs = &input; process.audio_outputs = &output;
		process.audio_inputs_count = process.audio_outputs_count = 1; process.in_events = &events;
		require(plugin->process(plugin, &process) != CLAP_PROCESS_ERROR, "process automation");
		for (int frame = 0; frame < 8; ++frame) require(std::abs(left[frame] - 1) < 1e-6f, "automation changed earlier samples");
		require(left[8] < left[7] && left[16] < left[8], "gain smoothing starts at the event offset");
		plugin->reset(plugin);
		std::cout << "CLAP sample-offset automation and in-place processing passed\n";
		return 0;
	} catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
