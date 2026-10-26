/* SPDX-License-Identifier: GPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { initializePffft } from '../src/common/editor/pffft.js';
import { renderLiveWork } from './helpers/audacity-live-runtime-work-fixture.ts';
await initializePffft();

test('Click Removal owns one synchronous kernel workspace across all analysis windows', (context) => {
	const original = Float64Array; let arrays = 0;
	globalThis.Float64Array = new Proxy(original, { construct(target, args) {
		if (new Error().stack?.includes('createAudacityClickRemovalWorkspace')) arrays += 1;
		return Reflect.construct(target, args, target) as Float64Array;
	} });
	context.after(() => { globalThis.Float64Array = original; });
	assert.equal(renderLiveWork('click'), 'be51a263368160cc6bed92cd827007538b9d4fb916592c2de5fd911d3bf40003');
	assert.equal(arrays, 3);
});

test('cross-rate live Noise Reduction reuses bounded private PCM planes with exact public output', (context) => {
	const original = Float32Array; let arrays = 0;
	globalThis.Float32Array = new Proxy(original, { construct(target, args) {
		const stack = new Error().stack ?? '';
		if (typeof args[0] === 'number' && stack.includes('/rate-converted-noise-reduction.ts')
			&& !stack.includes('/resample.js') && !stack.includes('/live-spectral-processors.js') && !stack.includes('SampleQueue')) arrays += 1;
		return Reflect.construct(target, args, target) as Float32Array;
	} });
	context.after(() => { globalThis.Float32Array = original; });
	assert.equal(renderLiveWork('converted-noise'), 'b677194c18e9f1d592893a0189316c1b30eab8952d69b0afbd2bef139a6e7cbe');
	assert.ok(arrays <= 12, `bounded PCM allocations: ${String(arrays)}`);
});

test('live compressor delay advances a PCM ring without copying the whole lookahead history', (context) => {
	const set = Float32Array.prototype.set; let historyCopies = 0;
	context.mock.method(Float32Array.prototype, 'set', function (this: Float32Array, values: ArrayLike<number>, offset?: number) {
		if (values.length === 48000 && new Error().stack?.includes('/live-dynamics-processors.js')) historyCopies += 1;
		return set.call(this, values, offset);
	});
	assert.equal(renderLiveWork('dynamics'), '79b5931ee7fb1397d59ab984e3fbc4792a1a938e99d641e67aadea7796f92852');
	assert.equal(historyCopies, 0);
});

test('stable live Noise Reduction prepares its window once and reconstructs only the queued chunk', (context) => {
	const cos = Math.cos, original = Float64Array; let windows = 0, reconstructionArrays = 0;
	Object.defineProperty(Math, 'cos', { configurable: true, writable: true, value: (value: number) => {
		if (value >= 0 && value < 7 && new Error().stack?.includes('periodicHann')) windows += 1;
		return cos(value);
	} });
	context.after(() => Object.defineProperty(Math, 'cos', { configurable: true, writable: true, value: cos }));
	globalThis.Float64Array = new Proxy(original, { construct(target, args) {
		if (args[0] === 16384 && new Error().stack?.includes('reduceNoiseChannel')) reconstructionArrays += 1;
		return Reflect.construct(target, args, target) as Float64Array;
	} });
	context.after(() => { globalThis.Float64Array = original; });
	assert.equal(renderLiveWork('noise'), 'd3d066cc916c338fe447b249b7a181cca435766a85d59552d15a780eb7183cc4');
	assert.equal(windows, 4096, 'one profile capture and one owned live window');
	assert.equal(reconstructionArrays, 0, 'live accumulation owns only the4096 queued output frames');
});

test('owned live work preserves parameter edits, missing inputs, profile replacement and aliased public blocks', () => {
	for (const alias of [false, true]) {
		const options = { updates: true, missing: true, alias };
		assert.equal(renderLiveWork('click', options), '50248311ebee4a7fd2e4f687ebc676ed68683aee967790ea416c8716d09cd233');
		assert.equal(renderLiveWork('dynamics', options), '170dc7f9b0666d170056b35c8645b13eb0c69141c399cc7d4124f728da885f51');
		assert.equal(renderLiveWork('noise', options), '4518f5dd30f65538a6367ce8557ce7043257454fb4e2590f207d442f6b26011d');
		assert.equal(renderLiveWork('converted-noise', options), alias
			? 'ab9e50404ad751fd74396609e4e23e5e0c1b464b6104c94c84e37edea866dea3'
			: '0cc205b3f2a20701f6fa2c722d8168dae079cce9ef62351f0e4052893d924cc8');
	}
});
