/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findClipSilenceRegions } from '../src/common/editor/clip-silence-regions.ts';
import { integratedLoudnessPower } from '../src/common/editor/audacity-effects/basic-loudness.js';
import { createEbuR128Meter, createFixedWeightEbuR128Meter } from '../src/common/editor/ebu-r128.js';
import { measureBextLoudness } from '../src/common/editor/broadcast-loudness.ts';

test('split at silences stops reading once its first 128 deliverable regions are known', () => {
	const pcm = Float32Array.from({ length: 11_001 }, (_, frame) => frame % 11 === 0 ? 0.5 : 0);
	let reads = 0;
	const regions = findClipSilenceRegions({ timelineStartFrame: 0, durationFrames: pcm.length, sourceStartFrame: 0 }, {
		sampleRate: 1_000, numberOfChannels: 1, getChannelData() { reads += 1; return pcm; },
	});
	assert.deepEqual(regions, Array.from({ length: 128 }, (_, index) => [index * 11 + 1, index * 11 + 11]));
	assert.ok(reads <= 1_410, `the returned region limit also bounds scanning; received ${reads} reads`);
});

test('fixed-weight loudness retains all-channel peak, RMS and complete programme measurements', () => {
	const channels = Array.from({ length: 6 }, (_, channel) => Float32Array.from({ length: 4_800 }, (_, frame) =>
		Math.sin(frame * (channel + 1) / 20) * (channel === 3 ? 0.9 : 0.1)));
	const original = createEbuR128Meter({ sampleRate: 48_000, channelCount: 6, running: true });
	const prepared = createFixedWeightEbuR128Meter({ sampleRate: 48_000, channelCount: 6, running: true });
	original.push(channels); prepared.push(channels);
	assert.deepEqual(prepared.snapshot({ finishTruePeak: true, finishLoudness: true }), original.snapshot({ finishTruePeak: true, finishLoudness: true }));
	const report = measureBextLoudness(channels, 48_000);
	assert.ok(report.maxTruePeakLevel !== null && Number(report.maxTruePeakLevel) > -2, 'loud LFE still owns the true peak');
});

test('5.1 fixed loudness ignores the LFE filter while retaining exact programme loudness', () => {
	const channels = Array.from({ length: 6 }, (_, channel) => Float32Array.from({ length: 2_048 }, (_, frame) =>
		Math.sin(frame * (channel + 1) / 20) * 0.1));
	const reference = channels.map((channel, index) => index === 3 ? new Float32Array(channel.length) : channel);
	const expected = integratedLoudnessPower(reference, 48_000);
	let reads = 0;
	channels[3] = new Proxy(channels[3]!, { get(target, key) {
		if (typeof key === 'string' && /^\d+$/u.test(key)) reads += 1;
		return Reflect.get(target, key, target) as unknown;
	} });
	assert.equal(integratedLoudnessPower(channels, 48_000), expected);
	assert.equal(reads, 0, 'the authenticated zero-weight LFE lane needs no filter stages');
});
