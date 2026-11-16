/* SPDX-License-Identifier: AGPL-3.0-only */
#include "processor.h"
#include "editor.h"
#include "juce_message_dispatcher.h"
#include <clap/clap.h>
#include <cmath>
#include <cstring>

namespace {
using namespace soundscaper::effects;
constexpr const char *features[] = {CLAP_PLUGIN_FEATURE_AUDIO_EFFECT, nullptr};
const auto descriptors = []() {
	std::array<clap_plugin_descriptor_t, effectCatalog.size()> result{};
	for (size_t index = 0; index < result.size(); ++index) result[index] = {
		CLAP_VERSION, effectCatalog[index].id, effectCatalog[index].name, "Soundscaper", "https://soundscaper.org",
		"", "", "1.0.0", "Realtime JUCE DSP effect with portable embedded state.", features};
	return result;
}();
struct Instance {
	clap_plugin_t plugin{};
	Processor processor;
	std::unique_ptr<Editor> editor;
	uint32_t maximumFrames = 0;
	double sampleRate = 48000;
	explicit Instance(Kind kind) : processor(kind) {}
};
Instance &get(const clap_plugin_t *p) { return *static_cast<Instance *>(p->plugin_data); }
bool init(const clap_plugin_t *) { return true; }
void destroy(const clap_plugin_t *p)
{
	auto &value = get(p);
	if (value.editor) soundscaper::dispatchJuceMessageTask([&]() { value.editor.reset(); return SOUNDSCAPER_PRO_OK; });
	delete &value;
}
bool activate(const clap_plugin_t *p, double rate, uint32_t minimum, uint32_t maximum)
{
	if (minimum == 0 || minimum > maximum) return false;
	get(p).maximumFrames = maximum;
	get(p).sampleRate = rate;
	return get(p).processor.prepare(rate, maximum);
}
void deactivate(const clap_plugin_t *p) { get(p).processor.release(); }
bool start(const clap_plugin_t *) { return true; }
void stop(const clap_plugin_t *) {}
void reset(const clap_plugin_t *p) { get(p).processor.reset(); }

bool writeParameter(Processor &processor, clap_id id, double value)
{
	if (id >= processor.parameterCount()) return false;
	const auto count = effectSpec(processor.kind).parameters[id].choiceCount;
	return processor.setParameter(id, count > 1 ? value / (count - 1) : value);
}
void applyEvents(Processor &processor, const clap_input_events_t *events)
{
	if (events == nullptr || events->size == nullptr || events->get == nullptr) return;
	for (uint32_t i = 0, count = events->size(events); i < count; ++i) {
		const auto *header = events->get(events, i);
		if (header == nullptr || header->space_id != CLAP_CORE_EVENT_SPACE_ID || header->type != CLAP_EVENT_PARAM_VALUE
			|| header->size < sizeof(clap_event_param_value_t)) continue;
		const auto *event = reinterpret_cast<const clap_event_param_value_t *>(header);
		writeParameter(processor, event->param_id, event->value);
	}
}

clap_process_status process(const clap_plugin_t *p, const clap_process_t *request)
{
	if (request == nullptr || request->frames_count < 1 || request->frames_count > get(p).maximumFrames
		|| request->audio_inputs_count != 1 || request->audio_outputs_count != 1
		|| request->audio_inputs == nullptr || request->audio_outputs == nullptr) return CLAP_PROCESS_ERROR;
	const auto &input = request->audio_inputs[0]; auto &output = request->audio_outputs[0];
	output.constant_mask = 0;
	if (input.channel_count != 2 || output.channel_count != 2 || input.data32 == nullptr || output.data32 == nullptr)
		return CLAP_PROCESS_ERROR;
	for (int channel = 0; channel < 2; ++channel) {
		if (input.data32[channel] == nullptr || output.data32[channel] == nullptr) return CLAP_PROCESS_ERROR;
		if (input.data32[channel] != output.data32[channel])
			std::memcpy(output.data32[channel], input.data32[channel], request->frames_count * sizeof(float));
	}
	uint32_t offset = 0;
	const auto segment = [&](uint32_t end) {
		if (end == offset) return true;
		juce::AudioBuffer<float> audio(output.data32, 2, static_cast<int>(offset), static_cast<int>(end - offset));
		offset = end;
		return get(p).processor.process(audio);
	};
	const auto *events = request->in_events;
	if (events && events->size && events->get) {
		const auto count = events->size(events);
		if (count > 4096) return CLAP_PROCESS_ERROR;
		for (uint32_t index = 0; index < count; ++index) {
			const auto *header = events->get(events, index);
			if (!header || header->space_id != CLAP_CORE_EVENT_SPACE_ID || header->type != CLAP_EVENT_PARAM_VALUE) continue;
			if (header->size < sizeof(clap_event_param_value_t) || header->time < offset
				|| header->time >= request->frames_count || !segment(header->time)) return CLAP_PROCESS_ERROR;
			const auto *event = reinterpret_cast<const clap_event_param_value_t *>(header);
			if (!writeParameter(get(p).processor, event->param_id, event->value)) return CLAP_PROCESS_ERROR;
		}
	}
	return segment(request->frames_count) ? CLAP_PROCESS_CONTINUE : CLAP_PROCESS_ERROR;
}
uint32_t portCount(const clap_plugin_t *, bool) { return 1; }
bool port(const clap_plugin_t *, uint32_t index, bool input, clap_audio_port_info_t *info)
{
	if (index != 0 || info == nullptr) return false;
	*info = {}; info->id = input ? 1 : 2;
	std::strcpy(info->name, input ? "Input" : "Output");
	info->flags = CLAP_AUDIO_PORT_IS_MAIN; info->channel_count = 2;
	info->port_type = CLAP_PORT_STEREO; info->in_place_pair = input ? 2 : 1; return true;
}
uint32_t latency(const clap_plugin_t *p) { return get(p).processor.latencyFrames(); }
uint32_t tail(const clap_plugin_t *p)
{
	const auto seconds = get(p).processor.tailSeconds();
	return std::isfinite(seconds) ? static_cast<uint32_t>(std::min(std::ceil(seconds * get(p).sampleRate), static_cast<double>(INT32_MAX))) : INT32_MAX;
}
uint32_t parameterCount(const clap_plugin_t *p) { return get(p).processor.parameterCount(); }
bool parameterInfo(const clap_plugin_t *p, uint32_t index, clap_param_info_t *info)
{
	if (info == nullptr || index >= parameterCount(p)) return false;
	const auto &parameter = effectSpec(get(p).processor.kind).parameters[index];
	*info = {}; info->id = index; info->flags = CLAP_PARAM_IS_AUTOMATABLE;
	std::strncpy(info->name, parameter.name, sizeof(info->name) - 1);
	info->min_value = 0; info->max_value = 1; info->default_value = parameter.normalized(parameter.initial);
	if (parameter.choiceCount > 1) {
		info->flags |= CLAP_PARAM_IS_STEPPED | CLAP_PARAM_IS_ENUM;
		info->max_value = parameter.maximum; info->default_value = parameter.initial;
	}
	return true;
}
bool parameterValue(const clap_plugin_t *p, clap_id id, double *value)
{
	if (value == nullptr || id >= parameterCount(p)) return false;
	const auto &parameter = effectSpec(get(p).processor.kind).parameters[id];
	const auto normalized = get(p).processor.parameter(id);
	*value = parameter.choiceCount > 1 ? std::round(parameter.physical(static_cast<float>(normalized))) : normalized;
	return true;
}
bool valueText(const clap_plugin_t *p, clap_id id, double value, char *text, uint32_t size)
{
	if (text == nullptr || size < 1 || id >= parameterCount(p) || !std::isfinite(value)) return false;
	const auto &parameter = effectSpec(get(p).processor.kind).parameters[id];
	const auto label = parameter.choiceCount > 1
		? juce::String(parameter.choices[static_cast<size_t>(std::clamp(std::round(value), 0.0, static_cast<double>(parameter.choiceCount - 1)))])
		: juce::String(parameter.physical(static_cast<float>(value)), 2) + " " + parameter.unit;
	label.copyToUTF8(text, size); return true;
}
bool textValue(const clap_plugin_t *, clap_id, const char *, double *) { return false; }
void flush(const clap_plugin_t *p, const clap_input_events_t *in, const clap_output_events_t *) { applyEvents(get(p).processor, in); }

bool save(const clap_plugin_t *p, const clap_ostream_t *stream)
{
	if (stream == nullptr || stream->write == nullptr) return false;
	const auto bytes = get(p).processor.saveState();
	size_t offset = 0;
	while (offset < bytes.getSize()) {
		const auto written = stream->write(stream, static_cast<const char *>(bytes.getData()) + offset, bytes.getSize() - offset);
		if (written <= 0 || static_cast<uint64_t>(written) > bytes.getSize() - offset) return false;
		offset += static_cast<size_t>(written);
	}
	return true;
}
bool load(const clap_plugin_t *p, const clap_istream_t *stream)
{
	if (stream == nullptr || stream->read == nullptr) return false;
	juce::MemoryOutputStream bytes;
	std::array<char, 4096> chunk{};
	for (;;) {
		const auto count = stream->read(stream, chunk.data(), chunk.size());
		if (count < 0 || count > static_cast<int64_t>(chunk.size())) return false;
		if (count == 0) break;
		if (bytes.getDataSize() + static_cast<size_t>(count) > maximumImpulseBytes + 2048) return false;
		bytes.write(chunk.data(), static_cast<size_t>(count));
	}
	return get(p).processor.loadState(bytes.getData(), bytes.getDataSize());
}
bool supported(const clap_plugin_t *, const char *api, bool floating)
{
#if defined(_WIN32)
	const char *expected = CLAP_WINDOW_API_WIN32;
#elif defined(__APPLE__)
	const char *expected = CLAP_WINDOW_API_COCOA;
#else
	const char *expected = CLAP_WINDOW_API_X11;
#endif
	return floating && api != nullptr && std::strcmp(api, expected) == 0;
}
bool preferred(const clap_plugin_t *, const char **, bool *) { return false; }
bool guiCreate(const clap_plugin_t *p, const char *api, bool floating)
{
	if (!supported(p, api, floating)) return false;
	return soundscaper::dispatchJuceMessageTask([p]() {
		get(p).editor = std::make_unique<Editor>(get(p).processor); return SOUNDSCAPER_PRO_OK;
	}) == SOUNDSCAPER_PRO_OK;
}
void guiDestroy(const clap_plugin_t *p)
{
	soundscaper::dispatchJuceMessageTask([p]() { get(p).editor.reset(); return SOUNDSCAPER_PRO_OK; });
}
bool visible(const clap_plugin_t *p, bool show)
{
	return soundscaper::dispatchJuceMessageTask([p, show]() {
		if (!get(p).editor) return SOUNDSCAPER_PRO_UNSUPPORTED;
		get(p).editor->setVisible(show); return SOUNDSCAPER_PRO_OK;
	}) == SOUNDSCAPER_PRO_OK;
}
bool show(const clap_plugin_t *p) { return visible(p, true); }
bool hide(const clap_plugin_t *p) { return visible(p, false); }
bool scale(const clap_plugin_t *, double) { return false; }
bool size(const clap_plugin_t *p, uint32_t *width, uint32_t *height)
{
	if (!width || !height) return false;
	*width = 600; *height = get(p).processor.parameterCount() * 50 + 40
		+ (get(p).processor.kind == Kind::convolution ? 110 : 0); return true;
}
bool resizable(const clap_plugin_t *) { return false; }
bool hints(const clap_plugin_t *, clap_gui_resize_hints_t *) { return false; }
bool adjust(const clap_plugin_t *p, uint32_t *width, uint32_t *height) { return size(p, width, height); }
bool resize(const clap_plugin_t *, uint32_t, uint32_t) { return false; }
bool parent(const clap_plugin_t *, const clap_window_t *) { return false; }
void title(const clap_plugin_t *, const char *) {}
const clap_plugin_audio_ports_t ports{portCount, port};
const clap_plugin_latency_t latencyExtension{latency};
const clap_plugin_tail_t tailExtension{tail};
const clap_plugin_state_t state{save, load};
const clap_plugin_params_t parameters{parameterCount, parameterInfo, parameterValue, valueText, textValue, flush};
const clap_plugin_gui_t gui{supported, preferred, guiCreate, guiDestroy, scale, size, resizable,
	hints, adjust, resize, parent, parent, title, show, hide};
const void *extension(const clap_plugin_t *, const char *id)
{
	if (id == nullptr) return nullptr;
	if (std::strcmp(id, CLAP_EXT_AUDIO_PORTS) == 0) return &ports;
	if (std::strcmp(id, CLAP_EXT_LATENCY) == 0) return &latencyExtension;
	if (std::strcmp(id, CLAP_EXT_TAIL) == 0) return &tailExtension;
	if (std::strcmp(id, CLAP_EXT_STATE) == 0) return &state;
	if (std::strcmp(id, CLAP_EXT_PARAMS) == 0) return &parameters;
	if (std::strcmp(id, CLAP_EXT_GUI) == 0) return &gui;
	return nullptr;
}
void mainThread(const clap_plugin_t *p) { get(p).processor.collectRetired(); }
uint32_t count(const clap_plugin_factory_t *) { return static_cast<uint32_t>(descriptors.size()); }
const clap_plugin_descriptor_t *describe(const clap_plugin_factory_t *, uint32_t index)
{
	return index < descriptors.size() ? &descriptors[index] : nullptr;
}
const clap_plugin_t *create(const clap_plugin_factory_t *, const clap_host_t *host, const char *id)
{
	if (id == nullptr || host == nullptr || !clap_version_is_compatible(host->clap_version)) return nullptr;
	for (uint32_t index = 0; index < descriptors.size(); ++index) if (std::strcmp(id, descriptors[index].id) == 0) {
		try {
			auto value = std::make_unique<Instance>(effectCatalog[index].kind);
			value->plugin = {&descriptors[index], value.get(), init, destroy, activate, deactivate,
				start, stop, reset, process, extension, mainThread};
			return &value.release()->plugin;
		} catch (...) { return nullptr; }
	}
	return nullptr;
}
const clap_plugin_factory_t factory{count, describe, create};
std::atomic<uint32_t> entryReferences{0};
bool entryInit(const char *path) { if (!path || !*path) return false; ++entryReferences; return true; }
void entryDeinit() { if (--entryReferences == 0) soundscaper::shutdownJuceMessageDispatcher(); }
const void *factoryFor(const char *id)
{
	return id != nullptr && std::strcmp(id, CLAP_PLUGIN_FACTORY_ID) == 0 ? &factory : nullptr;
}
}
extern "C" CLAP_EXPORT const clap_plugin_entry_t clap_entry{CLAP_VERSION, entryInit, entryDeinit, factoryFor};
