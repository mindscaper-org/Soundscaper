// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include <cstdint>
#include <memory>
#include <span>
#include <string>

namespace soundscaper::tracktion_backend
{
struct OfflineEffectIdentity
{
	std::string format;
	std::string stableId;
	std::string sha256;
	bool operator==(const OfflineEffectIdentity&) const = default;
};

struct OfflineEffectSlot
{
	std::uint64_t id;
	OfflineEffectIdentity effect;
};

// The application admits the exact installation and owns the isolated process.
// Tracktion supplies only PCM and configuration for this detached render.
class OfflineEffectInstance
{
public:
	virtual ~OfflineEffectInstance() = default;
	virtual int latencyFrames() const = 0;
	virtual bool process(std::span<float> left, std::span<float> right) = 0;
};

class OfflineEffectHost
{
public:
	virtual ~OfflineEffectHost() = default;
	virtual std::unique_ptr<OfflineEffectInstance> openStereo(
		const OfflineEffectIdentity&, int sampleRate, int maximumFrames) = 0;
};
}
