/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_AUDIO_FRAME_RING_H
#define SOUNDSCAPER_AUDIO_FRAME_RING_H

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace soundscaper {

// Single producer and single consumer. Transactions publish complete frame
// ranges so a hardware callback can be split across transport packets.
class AudioFrameRing {
public:
	AudioFrameRing(uint32_t channels, uint32_t frames)
		: channelCount(channels), capacity(frames),
		storage(static_cast<std::size_t>(channels) * frames, 0.0f) {}

	bool push(const float *const *planes, uint32_t availableChannels, uint32_t frames)
	{
		const uint64_t write = written.load(std::memory_order_relaxed);
		if (frames > capacity - (write - read.load(std::memory_order_acquire))) return false;
		const auto offset = static_cast<uint32_t>(write % capacity);
		const auto first = std::min(frames, capacity - offset);
		for (uint32_t channel = 0; channel < channelCount; ++channel) {
			float *target = storage.data() + static_cast<std::size_t>(channel) * capacity;
			if (channel < availableChannels && planes != nullptr && planes[channel] != nullptr) {
				std::copy_n(planes[channel], first, target + offset);
				std::copy_n(planes[channel] + first, frames - first, target);
			} else {
				std::fill_n(target + offset, first, 0.0f);
				std::fill_n(target, frames - first, 0.0f);
			}
		}
		written.store(write + frames, std::memory_order_release);
		return true;
	}

	uint32_t availableFrames() const
	{
		const uint64_t consumed = read.load(std::memory_order_relaxed);
		return static_cast<uint32_t>(written.load(std::memory_order_acquire) - consumed);
	}

	bool pop(float *const *planes, uint32_t availableChannels, uint32_t frames)
	{
		if (availableFrames() < frames) return false;
		const uint64_t consumed = read.load(std::memory_order_relaxed);
		const auto offset = static_cast<uint32_t>(consumed % capacity);
		const auto first = std::min(frames, capacity - offset);
		for (uint32_t channel = 0; channel < availableChannels; ++channel) {
			if (planes == nullptr || planes[channel] == nullptr) continue;
			const float *source = storage.data() + static_cast<std::size_t>(std::min(channel, channelCount - 1u)) * capacity;
			std::copy_n(source + offset, first, planes[channel]);
			std::copy_n(source, frames - first, planes[channel] + first);
		}
		read.store(consumed + frames, std::memory_order_release);
		return true;
	}

private:
	const uint32_t channelCount;
	const uint32_t capacity;
	std::vector<float> storage;
	std::atomic<uint64_t> read{0u};
	std::atomic<uint64_t> written{0u};
};

} // namespace soundscaper

#endif
