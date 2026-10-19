/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityNormalize, applyAudacityRepeat } from '../src/common/editor/audacity-effects/basic.js';
import { applyAudacityPhaser } from '../src/common/editor/audacity-effects/realtime.js';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';

test('Normalize preserves borrowed PCM and returns owned channels with or without peak gain', () => {
	for (const applyGain of [true, false]) {
		const input = Float32Array.of(-0.7, 0.2, 0.8, -0.3);
		const actual = applyAudacityNormalize([input], 48000, { removeDc: true, applyGain });
		assert.notEqual(actual[0], input);
		assert.deepEqual(input, Float32Array.of(-0.7, 0.2, 0.8, -0.3));
	}
});

test('Repeat preserves exact PCM and signed zero across a long repeated output', () => {
	const input = Float32Array.of(-0, .2, -.7, .9);
	const result = applyAudacityRepeat([input], 48000, { count: 127 })[0];
	assert.deepEqual(result, Float32Array.from({ length: 512 }, (_, frame) => input[frame % 4]!));
});

test('offline and realtime Phaser reuse the fixed LFO shape denominator', (context) => {
	const original = Math.expm1;
	let denominatorCalls = 0;
	context.mock.method(Math, 'expm1', (value: number) => { if (value === 4) denominatorCalls++; return original(value); });
	const input = [Float32Array.from({ length: 1024 }, (_, frame) => Math.sin(frame * .1))];
	applyAudacityPhaser(input, 48000, {});
	const processor = createAudacityLiveProcessor('audacity-phaser', 48000);
	processor.process(input, input.map(channel => new Float32Array(channel.length)));
	assert.ok(denominatorCalls <= 2, `fixed denominator was evaluated ${denominatorCalls} times`);
});

test('live Distortion retains its table on a DC or mix-only update', (context) => {
	const processor = createAudacityLiveProcessor('audacity-distortion', 48000, { mode: 'medium-overdrive' }) as {
		updateParams(parameters: Readonly<Record<string, number | boolean>>): void;
	};
	const original = Math.exp;
	let exponentials = 0;
	context.mock.method(Math, 'exp', (value: number) => { exponentials++; return original(value); });
	processor.updateParams({ dcBlock: true, parameter2: 31 });
	assert.equal(exponentials, 0);
	processor.updateParams({ parameter1: 31 });
	assert.ok(exponentials > 0);
});
