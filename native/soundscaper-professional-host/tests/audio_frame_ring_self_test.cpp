/* SPDX-License-Identifier: AGPL-3.0-only */

#include "audio_frame_ring.h"

#include <algorithm>
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

}

int main()
{
	if (transfer(441u, 256u) && transfer(256u, 441u) && rejectsAWriteWithoutRoom()) return 0;
	std::cerr << "Audio frames were lost, duplicated, or reordered across unequal blocks.\n";
	return 1;
}
