/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { StandardEffectProcessor } from '../src/common/editor/first-party-effects/standard/worklet.js';
import { DelayProcessor } from '../src/common/editor/delay-worklet.js';
import { idleEffectHoldFrames } from '../src/common/editor/idle-effect-policy.ts';
import { withIdleParallelEffect } from '../src/common/editor/engine/idle-parallel-effect.ts';
import { ParametricEqWorkletProcessor } from '../src/common/editor/parametric-eq/worklet.js';

test('a silent standard worklet skips DSP and resumes on the first input block', (t) => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'sampleRate');
	Object.defineProperty(globalThis, 'sampleRate', { value: 48000, configurable: true });
	t.after(() => { if (previous) Object.defineProperty(globalThis, 'sampleRate', previous); else Reflect.deleteProperty(globalThis, 'sampleRate'); });
	const node = new StandardEffectProcessor({ processorOptions: { type: 'lowpass-filter', channelCount: 1, params: { frequency: 1000 } } });
	const reference = new StandardEffectProcessor({ processorOptions: { type: 'lowpass-filter', channelCount: 1, params: { frequency: 1000 } } });
	const original = node.processor.processBlock.bind(node.processor);
	let calls = 0;
	node.processor.processBlock = (input: readonly Float32Array[], output: readonly Float32Array[], frames: number) => {
		calls++; original(input, output, frames);
	};
	const input = [new Float32Array(128)], output = [new Float32Array(128)];
	for (let block = 0; block < 200; block++) assert.equal(node.process([input], [output]), true);
	assert.ok(calls > 0 && calls < 100, `DSP ran ${calls} times for 200 silent quanta`);
	const sleepingCalls = calls;
	input[0]![0] = 0.5;
	node.process([input], [output]);
	const expected = [new Float32Array(128)];
	reference.process([input], [expected]);
	assert.equal(calls, sleepingCalls + 1);
	assert.deepEqual(output, expected);
});

test('feedback delay preserves sparse echoes through long silent gaps', () => {
	const options = { processorOptions: { sampleRate: 8000, params: { time: 2, mix: 1, feedback: 0.5 } } };
	const node = new DelayProcessor(options), reference = new DelayProcessor(options);
	reference.idle.setEnabled(false);
	const input = [new Float32Array(128)], output = [new Float32Array(128)], expected = [new Float32Array(128)];
	let echoes = 0;
	for (let block = 0; block < 400; block++) {
		input[0]!.fill(0); if (block === 0) input[0]![0] = 1;
		node.process([input], [output]); reference.process([input], [expected]);
		assert.deepEqual(output, expected, `echo block ${block}`);
		if (output[0]!.some(sample => sample !== 0)) echoes++;
	}
	assert.equal(echoes, 3);
});

test('parallel DSP suspends, polls live preference changes and wakes for sidechains and edits', () => {
	let calls = 0, resets = 0;
	const control = new SharedArrayBuffer(4), word = new Int32Array(control);
	Atomics.store(word, 0, 1);
	const processor = withIdleParallelEffect({
		reset() { resets++; }, updateParams() { /* Closure has no parameters. */ },
		processBlock(_input, output) { calls++; for (const channel of output) channel.fill(0); },
	}, { id: 'delay', type: 'delay', params: {}, latencyFrames: 0, stateBytes: 0 }, 1000, control);
	const input = [new Float32Array(100)], output = [new Float32Array(100)];
	for (let block = 0; block < 10; block++) processor.processBlock(input, output, 100);
	assert.equal(calls, 3);
	assert.equal(resets, 1);
	Atomics.store(word, 0, 0);
	processor.processBlock(input, output, 100);
	assert.equal(calls, 4);
	Atomics.store(word, 0, 1);
	const detector = [new Float32Array(100)]; detector[0]![0] = 1e-9;
	processor.processBlock(input, output, 100, detector);
	assert.equal(calls, 5);
	processor.updateParams!({ time: 2 });
	processor.processBlock(input, output, 100);
	assert.equal(calls, 6);
});

test('unknown tails and free-running or spectral clocks remain active', () => {
	for (const type of ['native-plugin', 'auto-tune', 'tremolo', 'vocoder', 'bitcrusher',
		'audacity-phaser', 'audacity-wahwah', 'audacity-noise-reduction', 'audacity-graphic-eq']) {
		assert.equal(idleEffectHoldFrames(type, {}, 48000), Infinity, type);
	}
	assert.ok(idleEffectHoldFrames('limiter', { lookahead: 0.5, release: 1 }, 48000) >= 48000 * 0.5);
});

test('parallel parameter transitions keep advancing through silence', () => {
	let transitioning = true, calls = 0;
	const processor = withIdleParallelEffect({
		get transitioning() { return transitioning; }, reset() { /* No state. */ },
		processBlock(_input, output) { calls++; for (const channel of output) channel.fill(0); },
	}, { id: 'eq', type: 'parametric-eq', params: { bands: [] }, latencyFrames: 0, stateBytes: 0 }, 48000);
	const output = [new Float32Array(128)];
	for (let block = 0; block < 200; block++) processor.processBlock([], output, 128);
	assert.equal(calls, 200);
	transitioning = false;
	for (let block = 0; block < 200; block++) processor.processBlock([], output, 128);
	assert.ok(calls < 400);
});

test('the WASM EQ worklet sleeps without losing its configuration or the next input block', async () => {
	const wasmModule = await WebAssembly.compile(await readFile(new URL('../src/common/editor/parametric-eq/parametric-eq.wasm', import.meta.url)));
	const processorOptions = { wasmModule, sampleRate: 48000, channelCount: 1,
		params: { outputGain: 6, bands: [{ id: 'bell', enabled: true, type: 'peaking', frequency: 1000, gain: 6, q: 1, slope: 12 }] } };
	const node = new ParametricEqWorkletProcessor({ processorOptions });
	const reference = new ParametricEqWorkletProcessor({ processorOptions });
	let calls = 0;
	const process = node.runtime.process.bind(node.runtime);
	node.runtime.process = (input: readonly Float32Array[], output: readonly Float32Array[]) => {
		calls++; return process(input, output);
	};
	const input = [new Float32Array(128)], output = [new Float32Array(128)], expected = [new Float32Array(128)];
	for (let block = 0; block < 200; block++) assert.equal(node.process([input], [output]), true);
	assert.ok(calls > 0 && calls < 100);
	const before = calls;
	input[0]![0] = 0.25;
	node.process([input], [output]); reference.process([input], [expected]);
	assert.equal(calls, before + 1);
	assert.deepEqual(output, expected);
	assert.ok(output[0]!.some(sample => sample !== 0));
});
