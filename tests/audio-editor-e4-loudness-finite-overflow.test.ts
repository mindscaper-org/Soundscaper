/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityEffect } from '../src/common/editor/audacity-effects/index.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../src/common/editor/wav-pcm-chunk-reader.ts';
import { createBiquad, processBiquad } from '../src/common/editor/audacity-effects/basic-loudness.js';

for (const frequency of [1000, 8000]) test(`LUFS normalizes finite hot float WAV at ${String(frequency)}Hz`, async () => {
	const samples = Float32Array.from({ length: 48_000 }, (_, frame) => 3e38 * Math.sin(2 * Math.PI * frequency * frame / 48_000));
	const file = new File([new Uint8Array(encodeWav([samples], { sampleRate: 48_000, float: true }))], 'Hot.wav');
	const descriptor = await inspectWavBlobPcm(file);
	const { channels } = await createWavBlobPcmChunkReader(file, { descriptor }).readChunk(0);
	assert.deepEqual(channels, [samples], 'the maintained float WAV path preserves finite over-range samples');
	const before = samples.slice();
	const reference = applyAudacityEffect('audacity-loudness-normalization', [Float32Array.from(samples, sample => sample / 3e38)],
		48_000, { targetLufs: -23, dualMono: false }) as Float32Array[];
	const output = applyAudacityEffect('audacity-loudness-normalization', channels, 48_000,
		{ targetLufs: -23, dualMono: false }) as Float32Array[];
	assert.ok(output[0]!.every(Number.isFinite));
	const peak = Math.max(...output[0]!.map(Math.abs));
	assert.ok(peak > .04 && peak < .11, `normalization should produce ordinary audible PCM, got ${String(peak)}`);
	const error = Math.max(...output[0]!.map((sample, frame) => Math.abs(sample - reference[0]![frame]!)));
	assert.ok(error < .0001, `uniform amplitude must not change the normalized waveform: ${String(error)}`);
	assert.deepEqual(channels, [before], 'the original immutable source is not changed');
});

test('ordinary weighting retains its single-precision boundary and filter history', () => {
	const filter = createBiquad(.17, -.12, .03, -.8, .2);
	for (const sample of [.25, -.7, .11, 0, .4, -.1]) {
		const expected = sample * filter.b0 + filter.x1 * filter.b1 + filter.x2 * filter.b2
			- filter.y1 * filter.a1 - filter.y2 * filter.a2;
		assert.equal(processBiquad(sample, filter), Math.fround(expected));
		assert.equal(filter.y1, expected);
	}
});
