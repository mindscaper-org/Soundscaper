/* SPDX-License-Identifier: AGPL-3.0-only */
#include <juce_core/juce_core.h>
#include "catalog.h"
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
		require(factory && factory->get_plugin_count(factory) == 18, "CLAP factory exposes every JUCE effect");
		clap_host_t host{}; host.clap_version = CLAP_VERSION;
		for (uint32_t index = 0; index < factory->get_plugin_count(factory); ++index) {
			const auto &spec = soundscaper::effects::effectCatalog[index];
			const auto *descriptor = factory->get_plugin_descriptor(factory, index);
			require(descriptor && std::strcmp(descriptor->id, spec.id) == 0, "stable catalogue identity");
			const auto *effect = factory->create_plugin(factory, &host, descriptor->id);
			require(effect && effect->init(effect) && effect->activate(effect, 48000, 1, 128), "activate catalogue member");
			const auto *parameters = static_cast<const clap_plugin_params_t *>(effect->get_extension(effect, CLAP_EXT_PARAMS));
			require(parameters && parameters->count(effect) == spec.parameterCount, "catalogue parameter count");
			for (uint32_t id = 0; id < spec.parameterCount; ++id) {
				clap_param_info_t info{}; double value = -1; std::array<char, 128> text{};
				require(parameters->get_info(effect, id, &info) && parameters->get_value(effect, info.id, &value)
					&& std::abs(value - info.default_value) < 1e-6 && parameters->value_to_text(effect, info.id, value, text.data(), text.size()), "parameter metadata and defaults");
				if (spec.parameters[id].choiceCount > 1) {
					require((info.flags & CLAP_PARAM_IS_STEPPED) && info.max_value == spec.parameters[id].choiceCount - 1, "enum metadata");
					clap_event_param_value_t change{};
					change.header = {sizeof(change), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE, 0};
					change.param_id = info.id; change.value = info.max_value;
					clap_input_events_t events{&change, [](const auto *) -> uint32_t { return 1; },
						[](const clap_input_events_t *events, uint32_t) -> const clap_event_header_t * { return &static_cast<const clap_event_param_value_t *>(events->ctx)->header; }};
					parameters->flush(effect, &events, nullptr);
					require(parameters->get_value(effect, info.id, &value) && value == info.max_value, "enum physical values round trip");
				}
			}
			const auto *latency = static_cast<const clap_plugin_latency_t *>(effect->get_extension(effect, CLAP_EXT_LATENCY));
			require(latency && latency->get(effect) == (index == 14 ? 32u : 0u), "reported FIR latency");
			effect->deactivate(effect); effect->destroy(effect);
		}
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
