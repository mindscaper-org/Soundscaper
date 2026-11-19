/* SPDX-License-Identifier: AGPL-3.0-only */

#include "audio_frame_ring.h"
#include "juce_audio_adapter.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <iostream>
#include <iterator>
#include <vector>

namespace {

bool transfer(uint32_t producerFrames, uint32_t consumerFrames)
{
	// Small and not a multiple of either block size so both reads and writes
	// wrap independently across the end of the storage.
	soundscaper::AudioFrameRing ring(2u, 719u);
	std::vector<float> sourceLeft(producerFrames), sourceRight(producerFrames);
	std::vector<float> targetLeft(consumerFrames), targetRight(consumerFrames);
	const float *sources[] = { sourceLeft.data(), sourceRight.data() };
	float *targets[] = { targetLeft.data(), targetRight.data() };
	uint32_t written = 0;
	uint32_t read = 0;
	for (int block = 0; block < 75; ++block) {
		for (uint32_t i = 0; i < producerFrames; ++i) {
			sourceLeft[i] = static_cast<float>(written + i + 1u);
			sourceRight[i] = -sourceLeft[i];
		}
		if (!ring.push(sources, 2u, producerFrames)) return false;
		written += producerFrames;
		while (written - read >= consumerFrames) {
			if (!ring.pop(targets, 2u, consumerFrames)) return false;
			for (uint32_t i = 0; i < consumerFrames; ++i) {
				const auto expected = static_cast<float>(read + i + 1u);
				if (targetLeft[i] != expected || targetRight[i] != -expected) return false;
			}
			read += consumerFrames;
		}
		if (ring.availableFrames() != written - read || ring.pop(targets, 2u, consumerFrames)) return false;
	}
	return read != 0;
}

bool rejectsAWriteWithoutRoom()
{
	soundscaper::AudioFrameRing ring(1u, 5u);
	const float samples[] = { 1.0f, 2.0f, 3.0f };
	const float *sources[] = { samples };
	float output[3]{};
	float *targets[] = { output };
	return ring.push(sources, 1u, 3u) && !ring.push(sources, 1u, 3u)
		&& ring.availableFrames() == 3u && ring.pop(targets, 1u, 3u)
		&& std::equal(std::begin(samples), std::end(samples), output)
		&& ring.availableFrames() == 0u;
}

bool startsAsioWithBatchedProducer(uint32_t producerFrames, bool delayed)
{
	constexpr uint32_t packetFrames = 256u;
	const auto startFrames = soundscaper::jucePlaybackStartFrames("asio", false, packetFrames, packetFrames);
	soundscaper::AudioFrameRing ring(1u, 16u * packetFrames);
	const std::array<float, packetFrames> silence{};
	const float *source[] = { silence.data() };
	std::array<float, packetFrames> rendered{};
	float *target[] = { rendered.data() };
	uint32_t producerBlock = 0;
	uint32_t sent = 0;
	bool started = false;
	for (uint32_t elapsed = 0; elapsed < 48'000u; elapsed += packetFrames) {
		// One producer callback can reach the device a native period late.
		while (producerBlock * producerFrames + (delayed && producerBlock == 2u ? packetFrames : 0u) <= elapsed) {
			const auto produced = ++producerBlock * producerFrames;
			while (sent + packetFrames <= produced) {
				if (!ring.push(source, 1u, packetFrames)) return false;
				sent += packetFrames;
			}
		}
		started = started || ring.availableFrames() >= startFrames;
		if (started && !ring.pop(target, 1u, packetFrames)) return false;
	}
	return started;
}

bool recoversOneLateAsioPeriod()
{
	constexpr uint32_t period = 4u;
	soundscaper::AudioFrameRing ring(2u, 3u * period);
	std::array<float, period> left{}, right{};
	float *targets[] = { left.data(), right.data() };
	const float *sources[] = { left.data(), right.data() };
	bool missed = false;
	const auto read = [&] { return soundscaper::readAsioOutputPeriod(ring, targets, 2u, period, missed); };
	const auto push = [&](float value) {
		left.fill(value);
		right.fill(-value);
		return ring.push(sources, 2u, period);
	};
	const auto equals = [&](float value) {
		return std::all_of(left.begin(), left.end(), [=](float sample) { return sample == value; })
			&& std::all_of(right.begin(), right.end(), [=](float sample) { return sample == -value; });
	};
	return push(1.0f) && read() && equals(1.0f)
		&& read() && equals(0.0f)
		&& push(2.0f) && push(3.0f) && read() && equals(3.0f)
		&& read() && equals(0.0f)
		&& push(4.0f) && !read() && ring.availableFrames() == 0u;
}

}

int main()
{
	if (!transfer(441u, 256u) || !transfer(256u, 441u) || !rejectsAWriteWithoutRoom()) {
		std::cerr << "Audio frames were lost, duplicated, or reordered across unequal blocks.\n";
		return 1;
	}
	if (!startsAsioWithBatchedProducer(480u, false) || !startsAsioWithBatchedProducer(512u, true)) {
		std::cerr << "ASIO playback exhausted its startup reserve with batched render packets.\n";
		return 1;
	}
	if (!recoversOneLateAsioPeriod()) {
		std::cerr << "ASIO playback replayed a late block, or failed to detect sustained starvation.\n";
		return 1;
	}
	return 0;
}
