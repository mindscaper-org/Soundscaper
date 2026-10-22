/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findAudioClippingRegions } from '../src/common/editor/analysis.js';
import { clippingReport } from '../src/common/editor/specialized-audio-analysis.ts';

for (const channelCount of [2, 8]) test(`Find clipping requires a consecutive run in one of ${channelCount} channels`, () => {
	const channels = Array.from({ length: channelCount }, () => new Float32Array(100));
	for (let frame = 0; frame < 50; frame++) channels[frame % channelCount]![frame] = 1.25;
	assert.deepEqual(findAudioClippingRegions(channels, { minimumConsecutiveSamples: 3 }), [],
		'isolated peaks in different channels cannot form one consecutive clipped run');
	channels[channelCount - 1]!.fill(1.5, 60, 63);
	const report = clippingReport('master', { startFrame: 1_000, endFrame: 1_100 }, channels, {});
	assert.equal(report.regionCount, 1);
	assert.deepEqual(report.regions, [{ startFrame: 1_060, endFrame: 1_063, frameCount: 3, clippedSamples: 3, peakAmplitude: 1.5 }]);
});

test('linked clipping reports retain simultaneous short-channel peaks inside an admitted run', () => {
	const channels = [Float32Array.of(0, 1.1, 1.2, 1.3, 0, 0), Float32Array.of(0, 0, -1.4, -1.2, 1.8, 0)];
	assert.deepEqual(findAudioClippingRegions(channels), [{ startFrame: 1, endFrame: 5, frameCount: 4,
		clippedSamples: 6, peakAmplitude: Math.abs(channels[1]![4]!) }]);
});
