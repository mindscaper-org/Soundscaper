/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DynamicsProcessor } from '../src/common/editor/dynamics-worklet.js';
import { LimiterLookaheadPeakWindow, limiterLookaheadPeakWindowBytes } from '../src/common/editor/limiter-lookahead-peak-window.ts';
import { compileParallelStackEffect } from '../src/common/editor/engine/parallel-stack-effects.ts';
import { createParallelDynamics } from '../src/common/editor/engine/parallel-stack-effects-dynamics.ts';

const RATE = 48_000;
const CEILING = 20 * Math.log10(.5);

function render(lookahead: number, parallel: boolean): Float32Array {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'sampleRate');
	Object.defineProperty(globalThis, 'sampleRate', { configurable: true, value: RATE });
	try {
		const params = { ceiling: CEILING, lookahead, release: .01 };
		const worklet = new DynamicsProcessor({ processorOptions: { type: 'limiter', params } });
		const kernel = createParallelDynamics('limiter', params, RATE, 1);
		const delay = Math.ceil(lookahead * RATE);
		const input = new Float32Array(RATE / 2 + delay).fill(.1);
		input[RATE / 4] = 1;
		const output = new Float32Array(input.length);
		for (let offset = 0; offset < input.length; offset += 128) {
			const source = input.subarray(offset, offset + 128);
			const target = output.subarray(offset, offset + 128);
			if (parallel) kernel.processBlock([source], [target], source.length);
			else worklet.process([[source]], [[target]]);
		}
		return output.subarray(delay);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'sampleRate', previous);
		else Reflect.deleteProperty(globalThis, 'sampleRate');
	}
}

for (const parallel of [false, true]) test(`${parallel ? 'parallel' : 'worklet'} limiter release follows the audible transient rather than its future detector`, () => {
	const immediate = render(0, parallel);
	const ahead = render(.1, parallel);
	const transient = RATE / 4;
	assert.ok(Math.abs(immediate[transient]! - .5) < 1e-7);
	assert.ok(Math.abs(ahead[transient]! - .5) < 1e-7);
	for (const distance of [1, 120, 480, 960]) {
		const expected = .1 * (1 - .5 * Math.exp(-distance / (.01 * RATE)));
		assert.ok(Math.abs(immediate[transient + distance]! - expected) < 1e-7);
		assert.ok(Math.abs(ahead[transient + distance]! - expected) < 1e-7,
			`post-transient frame ${distance}: actual ${ahead[transient + distance]}, expected ${expected}`);
	}
});

for (const lookahead of [0, 1, 4, 481]) test(`lookahead ${lookahead} preserves the exact peak over wrapping windows and reset`, () => {
	const window = new LimiterLookaheadPeakWindow(lookahead);
	const peaks = Array.from({ length: 2000 }, (_, frame) => frame % 127 === 0 ? 1 : frame % 83 === 0 ? .7 : (frame % 23) / 50);
	for (let iteration = 0; iteration < 2; iteration++) {
		window.reset();
		for (let frame = 0; frame < peaks.length; frame++) {
			const reference = Math.max(...peaks.slice(Math.max(0, frame - lookahead), frame + 1));
			assert.equal(window.push(peaks[frame]!), reference);
		}
	}
});

test('parallel limiter admission includes the peak window while the gate retains its state allowance', () => {
	const frames = 4800;
	const descriptor = compileParallelStackEffect({ type: 'limiter', params: { lookahead: .1 } }, RATE, 2);
	assert.equal(descriptor.stateBytes, 65536 + 2 * 4096 + (frames + 1) * 2 * 4 + limiterLookaheadPeakWindowBytes(frames));
	const gate = compileParallelStackEffect({ type: 'gate', params: {} }, RATE, 2);
	assert.equal(gate.stateBytes, 65536 + 2 * 4096 + 2 * 4);
});
