/* SPDX-License-Identifier: GPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { initializePffft } from '../src/common/editor/pffft.js';
import { applyAudacityNoiseReduction, captureAudacityNoiseProfile } from '../src/common/editor/audacity-effects/spectral.js';
import { createPreparedLiveNoiseReduction } from '../src/common/editor/audacity-effects/prepared-live-noise-reduction.ts';
await initializePffft();

test('owned live output intervals exactly match complete offline Noise Reduction across supported clocks and edits', () => {
	for (const sampleRate of [8000, 44100, 48000, 96000, 192000, 768000]) {
		const left = 2048 + (3 + Math.floor(0.1 * sampleRate / 512)) * 512;
		const right = 2048 + (3 + Math.floor(0.02 * sampleRate / 512)) * 512;
		const frames = left + 4096 + right;
		const channels = [Float32Array.from({ length: frames }, (_, frame) => 0.2 * Math.sin(frame * 0.03) + 0.01 * Math.cos(frame * 0.19))];
		const profile = captureAudacityNoiseProfile([channels[0]!.subarray(0, 8192)], sampleRate);
		const prepared = createPreparedLiveNoiseReduction(profile, sampleRate, frames);
		for (const params of [{ reductionDb: 12, sensitivity: 6, frequencySmoothingBands: 3, output: 'reduce' },
			{ reductionDb: 9, sensitivity: 8, frequencySmoothingBands: 5, output: 'residue' },
			{ reductionDb: 0, output: 'reduce' }, { reductionDb: 0, output: 'residue' }]) {
			const expected = applyAudacityNoiseReduction(channels, sampleRate, params, profile)[0]!.slice(left, left + 4096);
			assert.deepEqual(prepared.process(channels, params, left, left + 4096)[0], expected);
		}
		const expected = prepared.process(channels, { reductionDb: 12 }, left, left + 4096);
		profile.meanPowers.fill(0);
		assert.deepEqual(prepared.process(channels, { reductionDb: 12 }, left, left + 4096), expected, 'profile custody is detached');
	}
});
