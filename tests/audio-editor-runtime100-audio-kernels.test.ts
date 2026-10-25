/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStandardFilterProcessor } from '../src/common/editor/first-party-effects/standard/filters-dsp.ts';
import { createVocoderProcessor } from '../src/common/editor/first-party-effects/standard/vocoder-dsp.ts';
import { createImpulseResponse } from '../src/common/editor/engine/buffer-math.ts';

function signal(frames: number): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => Math.sin(frame * .13) * .3);
}

test('A01 standard filter resolves each channel buffer once per block', () => {
	const samples = signal(257);
	let reads = 0;
	const input: Float32Array[] = [];
	Object.defineProperty(input, 0, { get() { reads++; return samples; } });
	const processor = createStandardFilterProcessor({ type: 'highpass-filter', sampleRate: 48000, channelCount: 1, params: {} });
	const output = [new Float32Array(samples.length)];
	processor.processBlock(input, output, samples.length);
	assert.ok(reads <= 3, `channel lookups: ${reads}`);
	const reference = createStandardFilterProcessor({ type: 'highpass-filter', sampleRate: 48000, channelCount: 1, params: {} });
	const expected = [new Float32Array(samples.length)];
	reference.processBlock([samples], expected, samples.length);
	assert.deepEqual(output, expected);
	processor.reset();
	const aliased = [samples.slice()];
	processor.processBlock(aliased, aliased, samples.length);
	assert.deepEqual(aliased, expected);
	assert.throws(() => processor.processBlock([samples.subarray(1)], output, samples.length), RangeError);
});

test('A02 impulse generation shares the decay envelope between stereo channels', () => {
	const frames = 113;
	const output = [new Float32Array(frames), new Float32Array(frames)];
	let channelReads = 0;
	const buffer = { numberOfChannels: 2, getChannelData(channel: number) { channelReads++; return output[channel]!; } };
	const context = { sampleRate: 48000, createBuffer() { return buffer; } } as unknown as BaseAudioContext;
	let decayCalculations = 0;
	const decay = { valueOf() { decayCalculations++; return 2.7; } } as unknown as number;
	createImpulseResponse(context, frames / 48000, decay);
	assert.equal(decayCalculations, frames);
	for (let channel = 0; channel < 2; channel++) {
		let seed = 0x1234567 + channel * 997;
		const expected = Float32Array.from({ length: frames }, (_, index) => {
			seed = (seed * 16807) % 2147483647;
			return (seed / 1073741823.5 - 1) * ((1 - index / frames) ** 2.7);
		});
		assert.deepEqual(output[channel], expected);
	}
	assert.equal(channelReads, 2);
});


test('A12 vocoder bank update shares identical band and envelope trigonometry', () => {
	const processor = createVocoderProcessor({ sampleRate: 48000, channelCount: 2, params: { bands: 40 } });
	const original = Math.sin;
	let designs = 0;
	Math.sin = angle => { designs++; return original(angle); };
	try { processor.updateParams({ bands: 20 }); } finally { Math.sin = original; }
	assert.equal(designs, 40);
	const expected = createVocoderProcessor({ sampleRate: 48000, channelCount: 2, params: { bands: 20 } });
	const input = [signal(257), signal(257)];
	const output = input.map(() => new Float32Array(257));
	const reference = input.map(() => new Float32Array(257));
	processor.processBlock(input, output, 257);
	expected.processBlock(input, reference, 257);
	assert.deepEqual(output, reference);
});
