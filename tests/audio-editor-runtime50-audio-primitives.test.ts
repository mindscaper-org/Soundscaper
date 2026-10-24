/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findNearestAudioZeroCrossing, createStreamingAudioAnalyzer } from '../src/common/editor/analysis.js';
import { getProjectDurationFrames } from '../src/common/editor/engine/buffer-math.ts';
import { reconcileEngineChannelMeters } from '../src/common/editor/engine/engine-channel-meter-aggregate.ts';
import { readParametricEqSpectrumEntry, type EffectAnalyserEntry } from '../src/common/editor/engine/effect-spectrum.ts';
import { ParallelStackDelay } from '../src/common/editor/engine/parallel-stack-routing.ts';

function countNumbers(run: () => void): number {
	const original = globalThis.Number;
	let count = 0;
	globalThis.Number = new Proxy(original, { apply(target, receiver, args) {
		count++;
		return Reflect.apply(target, receiver, args) as number;
	} });
	try { run(); } finally { globalThis.Number = original; }
	return count;
}

test('A01 zero crossing shares current samples between scoring and crossing detection', () => {
	const channels = [new Float32Array(101).fill(1), new Float32Array(101).fill(.5)];
	let actual = -1;
	const count = countNumbers(() => { actual = findNearestAudioZeroCrossing(channels, 50, { maximumDistance: 40 }); });
	assert.equal(actual, 50);
	assert.ok(count === 246, `81 candidate frames must require 243 sample conversions plus three option conversions, got ${count}`);
	for (const [left, right, target, expected] of [
		[[1, -1, 1], [1, -1, 1], 1, 1],
		[[1, 1, -1, 1], [1, 1, -1, 1], 1, 2],
		[[1, 0, 1, 0, 1], [1, 0, 1, 0, 1], 2, 2],
		[[1, .1, 1, .1, 1], [1, .2, 1, .2, 1], 2, 1],
		[[NaN, 1, 1], [NaN, 1, 1], 0, 0],
	] as const) {
		assert.equal(findNearestAudioZeroCrossing([Float32Array.from(left), Float32Array.from(right)], target), expected);
	}
	assert.equal(findNearestAudioZeroCrossing([new Float32Array()], 0), 0);
});

test('A02 streaming stereo report reuses correlation samples without changing chunk arithmetic', () => {
	const channels = [Float32Array.from({ length: 100 }, (_, i) => Math.sin(i) * .7),
		Float32Array.from({ length: 100 }, (_, i) => Math.cos(i) * .6)];
	const analyzer = createStreamingAudioAnalyzer({ sampleRate: 8000, channelCount: 2 });
	const count = countNumbers(() => { analyzer.push(channels); });
	assert.equal(count, 600, 'two EBU scans and the report scan each visit two channels once');
	const chunked = createStreamingAudioAnalyzer({ sampleRate: 8000, channelCount: 2 });
	for (let start = 0; start < 100; start += 7) chunked.push(channels.map(channel => channel.subarray(start, start + 7)));
	assert.deepEqual(chunked.finish(), analyzer.finish());
	assert.equal(analyzer.finish(), analyzer.finish());
	assert.throws(() => analyzer.push(channels), /finished/);
});

test('A07 channel meter reconciliation publishes scalars without temporary assignment records', (context) => {
	let allocations = 0;
	const original = Object.assign;
	context.mock.method(Object, 'assign', (...args: Parameters<typeof Object.assign>) => {
		allocations++;
		return original(...args) as object;
	});
	const frame = { master: { peak: 0, rms: 0, dbfs: -Infinity }, tracks: {}, groups: {}, sends: {},
		productionMeters: [{ strip: { kind: 'master' }, channels: [{ peak: .8, rms: .3 }, { peak: .5, rms: .4 }] }] };
	const result = reconcileEngineChannelMeters(frame as unknown as Parameters<typeof reconcileEngineChannelMeters>[0]);
	assert.equal(result, frame);
	assert.equal(frame.master.peak, .8);
	assert.equal(frame.master.rms, Math.sqrt((.3 ** 2 + .4 ** 2) / 2));
	assert.equal(frame.master.dbfs, 20 * Math.log10(.8));
	assert.equal(allocations, 0);
});

test('A09 project duration traverses authoritative clip storage without flattening it', () => {
	const clips = Array.from({ length: 1000 }, (_, i) => ({ timelineStartFrame: i * 10, durationFrames: 3 }));
	const original = Array.prototype[Symbol.iterator];
	let traversals = 0;
	Array.prototype[Symbol.iterator] = function <T>(this: T[]): ArrayIterator<T> {
		traversals++;
		return original.call(this) as ArrayIterator<T>;
	};
	let duration: number;
	try { duration = getProjectDurationFrames({ clips }); } finally { Array.prototype[Symbol.iterator] = original; }
	assert.equal(duration, 9993);
	assert.equal(traversals, 1);
	assert.equal(getProjectDurationFrames({ tracks: [{ clips: [{ timelineStartFrames: 5, frameLength: 12 }, null, 'missing'] }] }), 17);
	assert.equal(getProjectDurationFrames(null), 0);
	assert.equal(getProjectDurationFrames({ clips: [], tracks: [{ clips }] }), 0, 'flat storage remains authoritative');
});

test('A10 multichannel EQ spectrum shares one scratch buffer and retains Float32 accumulation order', () => {
	const source = Array.from({ length: 8 }, (_, channel) => Float32Array.from(
		{ length: 16 }, (_, bin) => bin === 0 ? -Infinity : -30 + channel * .37 + bin * .11,
	));
	const analysers = source.map(values => ({ getFloatFrequencyData(target: Float32Array): void { target.set(values); } }) as AnalyserNode);
	const entry = { input: analysers[0], output: analysers[0], inputChannels: analysers,
		metadata: { frequencyBinCount: 16, fftSize: 32, sampleRate: 48000, minDecibels: -120, maxDecibels: 0 } } as EffectAnalyserEntry;
	const expected = new Float32Array(16);
	for (const channel of source) for (let bin = 0; bin < expected.length; bin++) expected[bin] = expected[bin] + 10 ** (channel[bin] / 10);
	for (let bin = 0; bin < expected.length; bin++) expected[bin] = 10 * Math.log10(expected[bin] / source.length);
	const target = new Float32Array(16);
	const original = globalThis.Float32Array;
	let allocations = 0;
	globalThis.Float32Array = new Proxy(original, { construct(constructor, args) {
		allocations++;
		return Reflect.construct(constructor, args) as Float32Array;
	} });
	try {
		readParametricEqSpectrumEntry(entry, 'input', target);
		assert.equal(allocations, 1);
		readParametricEqSpectrumEntry(entry, 'input', target);
		assert.equal(allocations, 1, 'subsequent reads retain only the bank scratch');
	} finally { globalThis.Float32Array = original; }
	assert.deepEqual(target, expected);
});

test('A12 parallel integer delay reads its geometry once per block and preserves ring crossings', () => {
	const delay = new ParallelStackDelay(3, 2);
	let geometryReads = 0;
	Object.defineProperty(delay, 'frames', { get(): number { geometryReads++; return 3; } });
	const input = [Float32Array.from([1, -0, 3, 4, 5]), Float32Array.from([6, 7, 8, 9, 10])];
	delay.process(input, 5);
	assert.deepEqual(input, [Float32Array.from([0, 0, 0, 1, -0]), Float32Array.from([0, 0, 0, 6, 7])]);
	assert.equal(geometryReads, 1);
	const next = [Float32Array.from([11, 12]), Float32Array.from([13, 14])];
	delay.process(next, 2);
	assert.deepEqual(next, [Float32Array.from([3, 4]), Float32Array.from([8, 9])]);
	const bypass = new ParallelStackDelay(0, 1);
	const unchanged = [Float32Array.from([NaN, -0, Infinity])];
	bypass.process(unchanged, 3);
	assert.deepEqual(unchanged[0], Float32Array.from([NaN, -0, Infinity]));
});
