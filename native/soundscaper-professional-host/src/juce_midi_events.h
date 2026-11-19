/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include "professional_host_api.h"
#include <juce_audio_basics/juce_audio_basics.h>

namespace soundscaper {
/** Validate a complete channel-message block before exposing it to a vendor. */
inline soundscaper_pro_status populateJuceMidiEvents(juce::MidiBuffer &midi,
	const soundscaper_pro_midi_event *events, uint32_t count, uint32_t frames,
	uint32_t ceiling, bool acceptsMidi)
{
	midi.clear();
	if (!acceptsMidi || count > 65536u || frames == 0u || frames > ceiling || (count && events == nullptr)) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	for (uint32_t index = 0; index < count; ++index) {
		const auto &event = events[index];
		const auto type = event.data[0] & 0xf0u;
		const auto size = type == 0xc0u || type == 0xd0u ? 2u : 3u;
		if (event.frame >= frames || event.size != size || event.data[0] < 0x80u || event.data[0] >= 0xf0u
			|| event.data[1] > 127u || (event.size == 3u && event.data[2] > 127u)) {
			midi.clear(); return SOUNDSCAPER_PRO_FORMAT_REFUSED;
		}
		midi.addEvent(event.data, static_cast<int>(event.size), static_cast<int>(event.frame));
	}
	return SOUNDSCAPER_PRO_OK;
}
} // namespace soundscaper
