/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHumRemovalProcessor } from '../src/common/editor/first-party-effects/hum-removal/dsp.ts';
import { humRemovalTailSeconds, normalizeHumRemovalParams } from '../src/common/editor/first-party-effects/hum-removal/definition.ts';
import { applyStandardEffect } from '../src/common/editor/first-party-effects/standard/dsp.ts';
import { standardEffectStateBytes } from '../src/common/editor/first-party-effects/standard/selection-contract.ts';

function tone(frequency: number, rate: number, frames: number, level = .2): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => level * Math.sin(2 * Math.PI * frequency * frame / rate));
}

function amplitude(samples: Float32Array, frequency: number, rate: number): number {
	let real = 0;
	let imaginary = 0;
	const start = samples.length - rate;
	for (let frame = start; frame < samples.length; frame++) {
		const angle = 2 * Math.PI * frequency * frame / rate;
		real += samples[frame] * Math.cos(angle);
		imaginary += samples[frame] * Math.sin(angle);
	}
	return 2 * Math.hypot(real, imaginary) / rate;
}

for (const frequency of [50, 60]) {
	test(`Hum removal cuts ${frequency} Hz and its selected harmonics while preserving other tones`, () => {
		const rate = 48000;
		const tones = [frequency, frequency * 2, frequency * 3, frequency * 5, 437];
		const input = new Float32Array(rate * 4);
		for (const hz of tones) {
			const signal = tone(hz, rate, input.length, .1);
			for (let frame = 0; frame < input.length; frame++) input[frame] += signal[frame];
		}
		const [output] = applyStandardEffect('hum-removal', [input], rate, { frequency, harmonics: 3, bandwidth: 4, reduction: 30 });
		for (const hz of tones.slice(0, 3)) {
			const reduction = 20 * Math.log10(amplitude(output, hz, rate) / .1);
			assert.ok(Math.abs(reduction + 30) < .1, `${hz} Hz: ${reduction} dB`);
		}
		for (const hz of tones.slice(3)) assert.ok(Math.abs(amplitude(output, hz, rate) - .1) < .001, `${hz} Hz must remain`);
	});
}

test('zero reduction is an exact copy and channels never share filter history', () => {
	const rate = 8000;
	const input = [tone(60, rate, 8192), new Float32Array(8192), tone(430, rate, 8192, .3)];
	const bypass = applyStandardEffect('hum-removal', input, rate, { reduction: 0 });
	for (let channel = 0; channel < input.length; channel++) {
		assert.deepEqual(bypass[channel], input[channel]);
		assert.notEqual(bypass[channel], input[channel]);
	}
	const output = applyStandardEffect('hum-removal', input, rate, { frequency: 60 });
	assert.ok(output[1].every(value => value === 0));
	assert.deepEqual(output[2], applyStandardEffect('hum-removal', [input[2]], rate, { frequency: 60 })[0]);
});

test('streaming partitions, in-place processing and selection rendering produce identical PCM', () => {
	const rate = 44100;
	const params = { frequency: 49.7, harmonics: 7, bandwidth: 1.5, reduction: 24 };
	const input = [tone(49.7, rate, 24017), tone(349, rate, 24017)];
	const expected = applyStandardEffect('hum-removal', input, rate, params);
	for (const blockSize of [1, 127, 1024]) {
		const processor = createHumRemovalProcessor({ sampleRate: rate, channelCount: 2, params });
		const output = input.map(channel => channel.slice());
		for (let offset = 0; offset < input[0].length; offset += blockSize) {
			const block = output.map(channel => channel.subarray(offset, offset + blockSize));
			processor.processBlock(block, block, block[0].length);
		}
		assert.deepEqual(output, expected);
		processor.reset();
		processor.processBlock(input, output, input[0].length);
		assert.deepEqual(output, expected);
	}
});

test('live changes crossfade smoothly, use the latest queued settings and reset deterministically', () => {
	const rate = 8000;
	const params = { frequency: 60, harmonics: 3, bandwidth: 4, reduction: 30 };
	const processor = createHumRemovalProcessor({ sampleRate: rate, channelCount: 2, params });
	const input = [tone(60, rate, rate * 4), tone(60, rate, rate * 4)];
	const output = input.map(channel => new Float32Array(channel.length));
	processor.processBlock(input, output, input[0].length);
	processor.updateParams({ frequency: 50 });
	processor.updateParams({ harmonics: 32 });
	processor.updateParams({ frequency: 60, harmonics: 3, reduction: 0 });
	processor.processBlock(input, output, input[0].length);
	assert.deepEqual(output[0], output[1], 'the same fade must apply to every channel');
	for (let frame = 1; frame < 400; frame++) assert.ok(Math.abs(output[0][frame] - output[0][frame - 1]) < .03);
	assert.deepEqual(output[0].subarray(320), input[0].subarray(320), 'the final bypass wins after two 20 ms fades');
	processor.updateParams(params);
	processor.updateParams({ frequency: 50 });
	processor.reset();
	processor.processBlock(input, output, input[0].length);
	assert.deepEqual(output, applyStandardEffect('hum-removal', input, rate, { ...params, frequency: 50 }));
});

test('invalid configurations and malformed blocks fail without changing filter state or output', () => {
	for (const params of [{ frequency: 19 }, { frequency: NaN }, { harmonics: 33 }, { bandwidth: 0 }, { reduction: 61 }]) {
		assert.throws(() => normalizeHumRemovalParams(params), RangeError);
	}
	for (const [sampleRate, channelCount] of [[7999, 1], [384001, 1], [48000, 0], [48000, 33]]) {
		assert.throws(() => createHumRemovalProcessor({ sampleRate, channelCount }), RangeError);
	}
	const processor = createHumRemovalProcessor({ sampleRate: 8000, channelCount: 2 });
	const input = [tone(50, 8000, 512), new Float32Array(512)];
	const output = [new Float32Array(512).fill(.5), new Float32Array(512).fill(.5)];
	assert.throws(() => processor.updateParams({ frequency: Infinity }), RangeError);
	assert.throws(() => processor.processBlock(input, output, 513), RangeError);
	assert.throws(() => processor.processBlock(input, output.slice(0, 1), 512), RangeError);
	assert.throws(() => processor.processBlock(input, output, -1), RangeError);
	assert.ok(output.every(channel => channel.every(value => value === .5)));
	processor.processBlock(input, output, 512);
	assert.deepEqual(output, applyStandardEffect('hum-removal', input, 8000));
	input[0][0] = NaN;
	input[0][1] = Infinity;
	processor.processBlock(input, output, 512);
	assert.ok(output.every(channel => channel.every(Number.isFinite)));
	processor.processBlock([], output, 512);
	assert.ok(output.every(channel => channel.every(Number.isFinite)));
});

test('all maintained audio rates and 32-channel geometry remain finite at extreme settings', () => {
	for (const rate of [8000, 44100, 48000, 96000, 192000, 384000]) {
		for (const bandwidth of [.5, 20]) {
			const params = { frequency: 400, harmonics: 32, bandwidth, reduction: 60 };
			const processor = createHumRemovalProcessor({ sampleRate: rate, channelCount: 32, params });
			const input = Array.from({ length: 32 }, () => new Float32Array(1024));
			input[0][0] = 1;
			const output = input.map(channel => new Float32Array(channel.length));
			processor.processBlock(input, output, 1024);
			assert.ok(output[0].every(value => Number.isFinite(value) && Math.abs(value) <= 1));
			assert.ok(output.slice(1).every(channel => channel.every(value => value === 0)));
			assert.ok(standardEffectStateBytes('hum-removal', params, rate, 32) < 64 * 1024);
		}
	}
});

test('declared release covers the audible impulse tail and bypass has no tail', () => {
	const rate = 8000;
	const params = { frequency: 50, harmonics: 3, bandwidth: 20, reduction: 30 };
	const release = Math.ceil(humRemovalTailSeconds(params, rate) * rate);
	assert.ok(release > 0 && release < rate * 10);
	const input = new Float32Array(release + 1024);
	input[0] = 1;
	const [output] = applyStandardEffect('hum-removal', [input], rate, params);
	assert.ok(output.subarray(release).every(value => Math.abs(value) < .0001));
	assert.equal(humRemovalTailSeconds({ reduction: 0 }, rate), 0);
});
