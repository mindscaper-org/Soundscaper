/* SPDX-License-Identifier: AGPL-3.0-only */
#include "direct_clap_parameters.h"
#include <cmath>
#include <cstring>
#include <set>
#include <string>

namespace soundscaper {
DirectClapParameters::DirectClapParameters(const clap_plugin_t *value) : plugin(value),
	extension(static_cast<const clap_plugin_params_t *>(value->get_extension(value, CLAP_EXT_PARAMS)))
{
	if (extension == nullptr) return;
	if (!extension->count || !extension->get_info || !extension->get_value || !extension->flush) { valid_ = false; return; }
	const uint32_t size = extension->count(plugin);
	if (size > SOUNDSCAPER_PRO_MAX_PLUGIN_PARAMETERS) { valid_ = false; return; }
	std::set<clap_id> ids;
	for (uint32_t index = 0; index < size; ++index) {
		clap_param_info_t info{};
		if (!extension->get_info(plugin, index, &info) || info.id == CLAP_INVALID_ID
			|| !ids.insert(info.id).second || !std::isfinite(info.min_value) || !std::isfinite(info.max_value)
			|| !std::isfinite(info.default_value) || info.min_value > info.max_value
			|| info.default_value < info.min_value || info.default_value > info.max_value) { valid_ = false; return; }
		if ((info.flags & CLAP_PARAM_IS_READONLY) || !(info.flags & CLAP_PARAM_IS_AUTOMATABLE)) continue;
		if (info.min_value == info.max_value || !std::isfinite(info.max_value - info.min_value)) { valid_ = false; return; }
		soundscaper_pro_plugin_parameter description{};
		const auto id = std::to_string(info.id);
		std::strncpy(description.id, id.c_str(), sizeof(description.id) - 1);
		std::strncpy(description.name, info.name, sizeof(description.name) - 1);
		description.default_value = (info.default_value - info.min_value) / (info.max_value - info.min_value);
		description.minimum_value = 0; description.maximum_value = 1;
		description.flags = SOUNDSCAPER_PRO_PARAMETER_AUTOMATABLE;
		if (info.flags & CLAP_PARAM_IS_STEPPED) description.flags |= SOUNDSCAPER_PRO_PARAMETER_INTEGER;
		infos.push_back(info); descriptions.push_back(description);
	}
}
soundscaper_pro_status DirectClapParameters::describe(std::vector<soundscaper_pro_plugin_parameter> &out) const
{
	if (!valid_) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	out = descriptions; return SOUNDSCAPER_PRO_OK;
}
soundscaper_pro_status DirectClapParameters::read(uint32_t index, double &out) const
{
	if (!valid_ || index >= infos.size()) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	const auto &info = infos[index]; double value = 0;
	if (!extension->get_value(plugin, info.id, &value) || !std::isfinite(value)
		|| value < info.min_value || value > info.max_value) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	out = (value - info.min_value) / (info.max_value - info.min_value); return SOUNDSCAPER_PRO_OK;
}
soundscaper_pro_status DirectClapParameters::write(uint32_t index, double value)
{
	if (!valid_ || index >= infos.size() || !std::isfinite(value) || value < 0 || value > 1)
		return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	const auto &info = infos[index];
	clap_event_param_value_t event{};
	event.header = {sizeof(event), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE, 0};
	event.param_id = info.id; event.cookie = info.cookie;
	event.note_id = -1; event.port_index = -1; event.channel = -1; event.key = -1;
	event.value = info.min_value + value * (info.max_value - info.min_value);
	if (info.flags & CLAP_PARAM_IS_STEPPED) event.value = std::round(event.value);
	clap_input_events_t input{&event,
		[](const clap_input_events_t *) -> uint32_t { return 1; },
		[](const clap_input_events_t *events, uint32_t i) -> const clap_event_header_t * {
			return i == 0 ? &static_cast<const clap_event_param_value_t *>(events->ctx)->header : nullptr;
		}};
	clap_output_events_t output{nullptr,
		[](const clap_output_events_t *, const clap_event_header_t *) -> bool { return false; }};
	// The peer serializes parameter writes and processing on its processing RPC thread.
	extension->flush(plugin, &input, &output); return SOUNDSCAPER_PRO_OK;
}
}
