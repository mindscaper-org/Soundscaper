// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include "offline_effect.h"

#include <juce_core/juce_core.h>

#include <functional>
#include <mutex>

namespace soundscaper::tracktion_backend
{
class PeerEffectHost final : public OfflineEffectHost
{
public:
	explicit PeerEffectHost(std::function<juce::var(const juce::var&)>);
	std::unique_ptr<OfflineEffectInstance> openStereo(const OfflineEffectIdentity&, int sampleRate, int maximumFrames) override;

private:
	juce::var exchange(juce::DynamicObject::Ptr);
	class Instance;
	std::function<juce::var(const juce::var&)> transact;
	std::mutex stream;
	int sequence = 0;
	int instances = 0;
};
}
