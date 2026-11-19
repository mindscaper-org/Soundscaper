/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_JUCE_AUDIO_ADAPTER_H
#define SOUNDSCAPER_JUCE_AUDIO_ADAPTER_H

#include "audio_frame_ring.h"
#include "professional_host_api.h"

#include <algorithm>
#include <memory>
#include <string>
#include <string_view>

namespace soundscaper {

class JuceAudioSession {
public:
	virtual ~JuceAudioSession() = default;
	virtual soundscaper_pro_status read(float **planes, uint32_t channels, uint32_t frames) = 0;
	virtual soundscaper_pro_status write(const float *const *planes, uint32_t channels, uint32_t frames) = 0;
};

constexpr uint32_t jucePlaybackStartFrames(std::string_view backend,
	bool sharedWasapi, uint32_t transportFrames, uint32_t callbackFrames)
{
	if (sharedWasapi) return 2u * callbackFrames + transportFrames;
	// Reserve two periods beyond the first render while Web Audio delivers its next packet burst.
	return backend == "asio" ? 3u * transportFrames : transportFrames;
}

// ASIO's callback and transport periods match exactly. After a missed
// deadline the next block is stale, so discard it before playing again.
inline bool readAsioOutputPeriod(AudioFrameRing &output, float *const *planes,
	uint32_t channels, uint32_t frames, bool &missedPrevious)
{
	if (missedPrevious && !output.pop(nullptr, 0u, frames)) return false;
	if (output.pop(planes, channels, frames)) {
		missedPrevious = false;
		return true;
	}
	if (missedPrevious) return false;
	missedPrevious = true;
	for (uint32_t channel = 0; channel < channels; ++channel) {
		if (planes[channel] != nullptr) std::fill_n(planes[channel], frames, 0.0f);
	}
	return true;
}

soundscaper_pro_status enumerateJuceAudio(
	const std::string &backend, std::string &json);
soundscaper_pro_audio_result openJuceAudio(
	const soundscaper_pro_audio_request &request, std::unique_ptr<JuceAudioSession> &session);
soundscaper_pro_status readJuceAudio(
	JuceAudioSession &session, float **planes, uint32_t channels, uint32_t frames);
soundscaper_pro_status writeJuceAudio(
	JuceAudioSession &session, const float *const *planes, uint32_t channels, uint32_t frames);

} // namespace soundscaper

#endif
