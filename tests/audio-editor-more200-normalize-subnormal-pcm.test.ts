/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityEffect } from '../src/common/editor/audacity-effects/index.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../src/common/editor/wav-pcm-chunk-reader.ts';

for (const independent of [false, true]) for (const removeDc of [false, true]) {
	test(`Normalize preserves finite denormal WAV samples (independent=${String(independent)}, DC=${String(removeDc)})`, async () => {
		const input = [Float32Array.of(0, 1e-40, 0, -1e-40), Float32Array.of(0, 5e-41, 0, -5e-41)];
		const bytes = encodeWav(input, { float: true, sampleRate: 48_000 });
		const file = new File([new Uint8Array(bytes)], 'Quiet float.wav', { type: 'audio/wav' });
		const descriptor = await inspectWavBlobPcm(file);
		const reader = createWavBlobPcmChunkReader(file, { descriptor });
		const { channels } = await reader.readChunk(0);
		assert.deepEqual(channels, input, 'the supported WAV import retains the nonzero samples');
		const before = channels.map(channel => channel.slice());
		const output = applyAudacityEffect('audacity-normalize', channels, 48_000,
			{ peakDb: -1, applyGain: true, removeDc, stereoIndependent: independent }) as Float32Array[];
		assert.ok(output.every(channel => channel.every(Number.isFinite)), 'normalization must deliver finite PCM');
		const target = 10 ** (-1 / 20);
		assert.ok(Math.abs(output[0]![1]! - target) < 1e-6);
		assert.ok(Math.abs(output[1]![1]! - target * (independent ? 1 : input[1]![1]! / input[0]![1]!)) < 1e-6);
		assert.equal(output[0]![0], 0); assert.equal(output[0]![2], 0);
		assert.deepEqual(channels, before);
	});
}

test('Normalize retains its ordinary single-precision output and silent-channel behavior', () => {
	const input = [Float32Array.of(0, .125, -.25, .5), new Float32Array(4)];
	const output = applyAudacityEffect('audacity-normalize', input, 48_000,
		{ peakDb: -1, applyGain: true, removeDc: false, stereoIndependent: true }) as Float32Array[];
	const multiplier = Math.fround(10 ** (-1 / 20) / .5);
	assert.deepEqual(output, [Float32Array.from(input[0]!, sample => sample * multiplier), new Float32Array(4)]);
});

test('Normalize can raise the smallest finite Float32 samples without amplifying silence', () => {
	const input = [Float32Array.of(0, 2 ** -149, -(2 ** -149)), new Float32Array(3)];
	const output = applyAudacityEffect('audacity-normalize', input, 48_000,
		{ peakDb: 0, applyGain: true, removeDc: false, stereoIndependent: false }) as Float32Array[];
	assert.deepEqual(output, [Float32Array.of(0, 1, -1), new Float32Array(3)]);
});

test('Normalize keeps finite denormal PCM when gain adjustment is disabled', () => {
	const input = [Float32Array.of(0, 1e-40, -1e-40)];
	const output = applyAudacityEffect('audacity-normalize', input, 48_000,
		{ applyGain: false, removeDc: true }) as Float32Array[];
	assert.deepEqual(output, input); assert.notEqual(output[0], input[0]);
});

test('Normalize retains a representable quiet target when the gain rounds down to zero', async () => {
	const input = Float32Array.of(0, 3e38, 0, -3e38);
	const file = new File([new Uint8Array(encodeWav([input], { float: true, sampleRate: 48_000 }))], 'Hot float.wav');
	const descriptor = await inspectWavBlobPcm(file);
	const { channels } = await createWavBlobPcmChunkReader(file, { descriptor }).readChunk(0);
	assert.deepEqual(channels, [input]);
	const output = applyAudacityEffect('audacity-normalize', channels, 48_000,
		{ peakDb: -145, applyGain: true, removeDc: false }) as Float32Array[];
	assert.ok(Math.abs(output[0]![1]! / (10 ** (-145 / 20)) - 1) < 1e-6);
	assert.equal(output[0]![3], -output[0]![1]!);
});
