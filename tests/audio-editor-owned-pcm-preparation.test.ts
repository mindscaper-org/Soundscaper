/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMasteringSequenceV23 } from '../src/common/editor/mastering-sequence.ts';
import { createMasteringSequenceDeliveryPlan } from '../src/common/editor/mastering-sequence-delivery.ts';
import { renderMasteringSequenceDelivery } from '../src/common/editor/mastering-sequence-render.ts';
import { createAudioEditorSignalRenderer } from '../src/common/editor/signal-generator-renderer.ts';
import { createWavStreamEncoder, encodeWav } from '../src/common/editor/wav.js';
import { createAiffStreamEncoder, encodeAiff } from '../src/common/editor/aiff.js';

test('mastering copies the unity interior and retains exact fade and signed-zero samples', (context) => {
	const originalSet = Float32Array.prototype.set;
	let copied = 0;
	context.mock.method(Float32Array.prototype, 'set', function (this: Float32Array, input: ArrayLike<number>, offset?: number) {
		copied += input.length;
		return originalSet.call(this, input, offset);
	});
	const source = Float32Array.from({ length: 100 }, (_, index) => index % 3 ? index / 100 : -0);
	for (const [fadeInFrames, fadeOutFrames] of [[0, 0], [1, 1], [4, 6], [50, 50]]) {
		const plan = createMasteringSequenceDeliveryPlan(createMasteringSequenceV23({
			id: 'album', sequenceId: 'main', name: 'Album', entries: [{ id: 'entry', annotationId: 'region', gapBeforeFrames: 3, fadeInFrames, fadeOutFrames }],
		}), [{ id: 'region', sequenceId: 'main', startFrame: 0, endFrame: 100 }]);
		const [actual] = renderMasteringSequenceDelivery({ plan, channelCount: 1, segments: [{ entryId: 'entry', channels: [source] }] });
		const expected = new Float32Array(103);
		for (let frame = 0; frame < 100; frame += 1) {
			let gain = fadeInFrames > 0 && frame < fadeInFrames ? frame / fadeInFrames : 1;
			if (fadeOutFrames > 0 && 99 - frame < fadeOutFrames) gain = Math.min(gain, (99 - frame) / fadeOutFrames);
			expected[3 + frame] = source[frame]! * gain;
		}
		assert.deepEqual(actual, expected);
	}
	assert.equal(copied, 288, 'only nonoverlapping unity interiors use the bulk-copy path');
});

function renderMorse(text: string, wordsPerMinute: number, sampleRate: number, blockFrames: number): Float32Array {
	const renderer = createAudioEditorSignalRenderer('morse', { text, wordsPerMinute, sampleRate, amplitude: 0.7 });
	const output = new Float32Array(renderer.frameCount);
	let offset = 0;
	for (let block = renderer.next(blockFrames); block; block = renderer.next(blockFrames)) {
		output.set(block[0]!, offset);
		block[0]!.fill(123); // Returned buffers must never alias cached tones.
		offset += block[0]!.length;
	}
	return output;
}

test('Morse prepares short repeated reset-phase tones once per exact geometry', (context) => {
	const originalSin = Math.sin;
	let calls = 0;
	context.mock.method(Math, 'sin', (value: number) => { calls += 1; return originalSin(value); });
	renderMorse('PARIS PARIS PARIS', 20, 48_000, 65_536);
	assert.ok(calls <= 11_520, `two bounded tone lengths require 11520 sine evaluations, received ${calls}`);
	for (const blockFrames of [1, 127, 65_536]) {
		assert.deepEqual(renderMorse('PARIS', 20, 8_000, blockFrames), renderMorse('PARIS', 20, 8_000, 65_536));
		assert.deepEqual(renderMorse('E E', 13, 44_100, blockFrames), renderMorse('E E', 13, 44_100, 65_536));
	}
});

test('native PCM settlement visits outstanding writes and preserves sticky failures', async (context) => {
	const originalAll = Promise.all.bind(Promise);
	let visits = 0;
	context.mock.method(Promise, 'all', <T>(input: Iterable<T | PromiseLike<T>>) => {
		const entries = Array.from(input); visits += entries.length;
		return originalAll(entries);
	});
	for (const create of [createWavStreamEncoder, createAiffStreamEncoder]) {
		const encoder = create({ channelCount: 1, totalFrames: 20, bitDepth: 24, collect: false, onChunk: () => Promise.resolve() });
		for (let frame = 0; frame < 20; frame += 1) { encoder.write([Float32Array.of(0.5)]); await encoder.settled(); }
		encoder.finalize(); await encoder.settled();
		const reason = new Error('sink refused');
		const failed = create({ channelCount: 1, totalFrames: 0, collect: false, onChunk: () => Promise.reject(reason) });
		await assert.rejects(failed.settled(), (error: unknown) => error === reason);
		await assert.rejects(failed.settled(), (error: unknown) => error === reason);
	}
	assert.ok(visits <= 44, `completed writes must retire; received ${visits} promise visits`);
});

test('native PCM formats preserve exact quantization across streaming writes and dither states', async () => {
	const channels = [Float32Array.of(-2, -1, -0.5, -0, 0, 0.5, 1, 2, NaN, Infinity), Float32Array.of(0.1, -0.1, 0.2, -0.2, 0.3, -0.3, 0.4, -0.4, 0.9, -0.9)];
	const random = () => { let seed = 123; return () => ((seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0) / 0x1_0000_0000); };
	for (const [encode, create, depths] of [[encodeWav, createWavStreamEncoder, [16, 20, 24, 32]], [encodeAiff, createAiffStreamEncoder, [16, 24, 32]]] as const) {
		for (const bitDepth of depths) for (const dither of ['none', 'triangular', 'triangular-highpass'] as const) {
			const options = { sampleRate: 48_000, channelCount: 2, totalFrames: 10, bitDepth, dither };
			const expected = encode(channels, { ...options, random: random() });
			const encoder = create({ ...options, random: random(), collect: true });
			for (let index = 0; index < 10; index += 1) encoder.write(channels.map(channel => channel.subarray(index, index + 1)));
			assert.deepEqual(encoder.finalize(), expected);
			await encoder.settled();
		}
	}
});
