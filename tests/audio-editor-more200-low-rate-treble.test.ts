/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityEffect } from '../src/common/editor/audacity-effects/index.js';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../src/common/editor/wav-pcm-chunk-reader.ts';

for (const rate of [6000, 7350, 8000]) for (const trebleDb of [-6, 6]) test(`Bass/Treble retains finite ${String(rate)}Hz PCM with treble ${String(trebleDb)}`, async () => {
	const input = Float32Array.from({ length: rate }, (_, frame) => .1 * Math.sin(2 * Math.PI * 100 * frame / rate));
	const file = new Blob([new Uint8Array(encodeWav([input], { sampleRate: rate, float: true }))]);
	const descriptor = await inspectWavBlobPcm(file);
	const { channels } = await createWavBlobPcmChunkReader(file, { descriptor }).readChunk(0);
	const output = applyAudacityEffect('audacity-bass-treble', channels, rate, { bassDb: 6, trebleDb, volumeDb: -3 }) as Float32Array[];
	assert.ok(output[0]!.every(Number.isFinite));
	assert.ok(Math.max(...output[0]!.map(Math.abs)) < .2);
	const reference = applyAudacityEffect('audacity-bass-treble', channels, rate, { bassDb: 6, trebleDb: 0, volumeDb: -3 }) as Float32Array[];
	assert.ok(output[0]!.every((sample, frame) => Math.abs(sample - reference[0]![frame]!) < 1e-6), 'a high shelf beyond the Nyquist boundary must retain the in-band bass and volume result');
	assert.deepEqual(channels, [input]);
});

test('a low-clock live shelf and its release agree with finite selection processing', () => {
	const rate = 6000, params = { bassDb: 6, trebleDb: 6, volumeDb: -3 };
	const input = Float32Array.from({ length: rate }, (_, frame) => .1 * Math.sin(2 * Math.PI * 100 * frame / rate));
	const processor = createAudacityLiveProcessor('audacity-bass-treble', rate, params);
	const output = new Float32Array(rate); processor.process([input], [output]);
	assert.ok(output.every(Number.isFinite));
	const reference = applyAudacityEffect('audacity-bass-treble', [input], rate, params) as Float32Array[];
	assert.deepEqual(output, reference[0]);
	const release = new Float32Array(processor.tailFrames + 128);
	processor.process([new Float32Array(release.length)], [release]);
	assert.ok(release.every(Number.isFinite));
	assert.ok(release.subarray(processor.tailFrames).every(sample => Math.abs(sample) < .0001));
});
