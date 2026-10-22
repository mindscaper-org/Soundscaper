/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityEffect } from '../src/common/editor/audacity-effects/index.js';
import { analyzeAudioChannels } from '../src/common/editor/analysis.js';

for (const channelCount of [4, 5, 6, 8]) test(`independent Loudness Normalization reaches its programme target for ${String(channelCount)} channels`, () => {
	const sampleRate = 48_000;
	const channels = Array.from({ length: channelCount }, (_, channel) =>
		Float32Array.from({ length: sampleRate }, (_value, frame) => Math.sin(frame * 2 * Math.PI * 997 / sampleRate) * (channel + 1) / 20));
	const output = applyAudacityEffect('audacity-loudness-normalization', channels, sampleRate,
		{ mode: 'lufs', targetLufs: -23, stereoIndependent: true, dualMono: false });
	const measured = analyzeAudioChannels(output, sampleRate).integratedLufs;
	assert.equal(typeof measured, 'number');
	assert.ok(measured !== null);
	assert.ok(Math.abs(measured + 23) < 0.05, `Expected -23 LUFS, measured ${String(measured)}.`);
	if (channelCount === 6) assert.deepEqual(output[3], channels[3], 'Independent programme loudness cannot derive a gain for its excluded LFE channel.');
});
