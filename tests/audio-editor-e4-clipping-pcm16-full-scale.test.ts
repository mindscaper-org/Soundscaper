/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findAudioClippingRegions } from '../src/common/editor/audio-clipping-regions.ts';
import { clippingReport } from '../src/common/editor/specialized-audio-analysis.ts';

// Audacity 3.7.3 FindClippingBase.cpp uses MAX_AUDIO from MemoryX.h:
// https://github.com/audacity/audacity/blob/Audacity-3.7.3/libraries/lib-utility/MemoryX.h#L318
const PCM16_FULL_SCALE = 32_767 / 32_768;

for (const [sample, count] of [[32_767, 1], [-32_768, 1], [32_766, 0], [-32_766, 0]] as const) {
	test(`Find clipping recognizes the signed PCM16 endpoint ${sample}`, () => {
		const channel = Float32Array.of(0, sample / 32_768, sample / 32_768, sample / 32_768, 0);
		const report = clippingReport('master', { startFrame: 200, endFrame: 205 }, [channel], {});
		assert.equal(report.regionCount, count);
		assert.equal(report.threshold, PCM16_FULL_SCALE);
		if (count) assert.deepEqual(report.regions, [{ startFrame: 201, endFrame: 204, frameCount: 3,
			clippedSamples: 3, peakAmplitude: Math.abs(sample / 32_768) }]);
	});
}

test('the low-level detector shares the full-scale default while explicit thresholds remain authoritative', () => {
	const channel = Float32Array.of(0, PCM16_FULL_SCALE, PCM16_FULL_SCALE, PCM16_FULL_SCALE, 0);
	assert.equal(findAudioClippingRegions([channel]).length, 1);
	assert.deepEqual(findAudioClippingRegions([channel], { threshold: 1 }), []);
	assert.equal(clippingReport('master', { startFrame: 0, endFrame: 5 }, [channel], { threshold: 1 }).regionCount, 0);
	assert.equal(findAudioClippingRegions([Float32Array.of(.5, .5, .5)], { threshold: .5 }).length, 1);
	assert.deepEqual(findAudioClippingRegions([Float32Array.of(PCM16_FULL_SCALE, PCM16_FULL_SCALE)]), []);
});
