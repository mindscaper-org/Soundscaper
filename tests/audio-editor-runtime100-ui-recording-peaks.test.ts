/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { recordingPreviewWaveformWindow, toDesignRecordingPreview, type RecordingPeakChannel } from '../src/common/editor/ui/timeline/preview.ts';

type Clip = Parameters<typeof recordingPreviewWaveformWindow>[1];
function legacyWindow(channel: RecordingPeakChannel | null | undefined, clip: Clip): number[] {
	if (!channel?.length || !clip.durationFrames) return [];
	const pairCount = Math.max(1, Math.floor(channel.length / 2));
	const startPair = Math.max(0, Math.min(pairCount - 1, Math.floor(clip.waveformStartFrame / clip.durationFrames * pairCount)));
	const endPair = Math.max(startPair + 1, Math.min(pairCount, Math.ceil(clip.waveformEndFrame / clip.durationFrames * pairCount)));
	return Array.from(channel.slice(startPair * 2, endPair * 2));
}

test('U39 public recording preview avoids copying its native peak windows before boxing', context => {
	const channels = Array.from({ length: 8 }, (_, channel) => Float32Array.from({ length: 4096 }, (_, index) => ((index + channel) % 33 - 16) / 16));
	const clip = { id: 'recording', timelineStartFrame: 0, durationFrames: 8192, waveformStartFrame: 0, waveformEndFrame: 8192 };
	const original = Float32Array.prototype.slice;
	let copiedBytes = 0;
	Float32Array.prototype.slice = function (start?: number, end?: number) {
		const result = original.call(this, start, end); copiedBytes += result.byteLength; return result;
	};
	let output: ReturnType<typeof toDesignRecordingPreview>;
	try { output = toDesignRecordingPreview(clip, { channels }, 0, 1000, 48000, { recordingLabel: 'Recording' }, true); }
	finally { Float32Array.prototype.slice = original; }
	const digest = createHash('sha256').update(JSON.stringify(output)).digest('hex');
	context.diagnostic(`U39 temporary peak bytes ${copiedBytes}; exact preview JSON SHA256 ${digest}`);
	assert.equal(digest, '5f53b50b39328c8c7dff1c6b3d5a629c9326c518c56ad2c3b6c103bd286d68fa');
	assert.equal(output.spectrogramWaveform?.length, 8);
	const values = output.spectrogramWaveform?.[0];
	assert.ok(Array.isArray(values));
	assert.deepEqual(values, Array.from(channels[0]!));
	channels[0]![0] = 0.5;
	assert.equal(values[0], -1);
	values[1] = 0.25;
	assert.notEqual(channels[0]![1], 0.25);
	assert.equal(copiedBytes, 0);
});

test('U39 recording peak windows preserve bounds, sparse arrays and unusual numeric values', () => {
	const channels: RecordingPeakChannel[] = [[], [0], [0, -0, Number.NaN, Infinity, -Infinity], Float32Array.of(0, -0, Number.NaN, Infinity, -Infinity)];
	const sparse = [1, 2, 3, 4]; delete sparse[1]; channels.push(sparse);
	for (const channel of channels) for (const durationFrames of [0, -0, 1, 100]) {
		for (const [waveformStartFrame, waveformEndFrame] of [[0, 100], [-20, 30], [200, 500], [30.3, 55.8], [Number.NaN, Infinity], [-Infinity, Number.NaN]]) {
			const clip = { durationFrames, waveformStartFrame: waveformStartFrame!, waveformEndFrame: waveformEndFrame! };
			assert.deepEqual(recordingPreviewWaveformWindow(channel, clip), legacyWindow(channel, clip));
		}
	}
});

test('U39 recording peak windows retain stable constructor and subclass tracing', () => {
	const clip = { durationFrames: 100, waveformStartFrame: 0, waveformEndFrame: 100 };
	for (const kind of ['typed-constructor', 'subclass'] as const) {
		const fixture = () => {
			const trace: string[] = [];
			const channel = kind === 'subclass' ? new (class extends Float32Array {})([1, 2, 3, 4]) : Float32Array.of(1, 2, 3, 4);
			if (kind === 'typed-constructor') Object.defineProperty(channel, 'constructor', { get() { trace.push('constructor'); return Float32Array; } });
			return { channel, trace };
		};
		const actual = fixture(), expected = fixture();
		assert.deepEqual(recordingPreviewWaveformWindow(actual.channel, clip), legacyWindow(expected.channel, clip), kind);
		assert.deepEqual(actual.trace, expected.trace, kind);
	}
});

test('U39 shared buffers retain native slice ownership', () => {
	const clip = { durationFrames: 100, waveformStartFrame: 0, waveformEndFrame: 100 };
	const shared = new Float32Array(new SharedArrayBuffer(16)); shared.set([1, 2, 3, 4]);
	const original = Float32Array.prototype.slice;
	let slices = 0;
	Float32Array.prototype.slice = function (start?: number, end?: number) { slices++; return original.call(this, start, end); };
	try {
		assert.deepEqual(recordingPreviewWaveformWindow(shared, clip), [1, 2, 3, 4]);
	} finally { Float32Array.prototype.slice = original; }
	assert.equal(slices, 1);
});

test('U39 customized native species keeps the original copy-constructor arguments', () => {
	const clip = { durationFrames: 100, waveformStartFrame: 0, waveformEndFrame: 100 };
	const channel = Float32Array.of(1, 2, 3, 4), lengths: number[] = [];
	class Species extends Float32Array { constructor(length: number) { super(length); lengths.push(length); } }
	const original = Object.getOwnPropertyDescriptor(Float32Array, Symbol.species);
	Object.defineProperty(Float32Array, Symbol.species, { configurable: true, value: Species });
	try { assert.deepEqual(recordingPreviewWaveformWindow(channel, clip), [1, 2, 3, 4]); }
	finally { if (original) Object.defineProperty(Float32Array, Symbol.species, original); else Reflect.deleteProperty(Float32Array, Symbol.species); }
	assert.deepEqual(lengths, [4]);
});

test('U39 a customized prototype constructor retains its original read and species arguments', () => {
	const clip = { durationFrames: 100, waveformStartFrame: 0, waveformEndFrame: 100 };
	const channel = Float32Array.of(1, 2, 3, 4), trace: unknown[] = [];
	class Species extends Float32Array { constructor(length: number) { super(length); trace.push(length); } }
	const original = Object.getOwnPropertyDescriptor(Float32Array.prototype, 'constructor')!;
	Object.defineProperty(Float32Array.prototype, 'constructor', { configurable: true, get() {
		trace.push('constructor'); return { [Symbol.species]: Species };
	} });
	try { assert.deepEqual(recordingPreviewWaveformWindow(channel, clip), [1, 2, 3, 4]); }
	finally { Object.defineProperty(Float32Array.prototype, 'constructor', original); }
	assert.deepEqual(trace, ['constructor', 4]);
});

function median(values: number[]): number { return [...values].sort((a, b) => a - b)[values.length >>> 1]!; }

test('U39 recording peak window paired timing sanity', context => {
	const clip = { durationFrames: 8192, waveformStartFrame: 0, waveformEndFrame: 8192 };
	for (const length of [64, 4096]) {
		const channel = Float32Array.from({ length }, (_, index) => index / length);
		assert.deepEqual(recordingPreviewWaveformWindow(channel, clip), legacyWindow(channel, clip));
		for (let index = 0; index < 20; index++) { legacyWindow(channel, clip); recordingPreviewWaveformWindow(channel, clip); }
		const baseline: number[] = [], current: number[] = [];
		const run = (work: () => unknown, times: number[]) => { const start = performance.now(); for (let index = 0; index < 200; index++) work(); times.push((performance.now() - start) / 200); };
		for (let trial = 0; trial < 9; trial++) {
			if (trial % 2) { run(() => recordingPreviewWaveformWindow(channel, clip), current); run(() => legacyWindow(channel, clip), baseline); }
			else { run(() => legacyWindow(channel, clip), baseline); run(() => recordingPreviewWaveformWindow(channel, clip), current); }
		}
		context.diagnostic(`U39 ${length} peaks: baseline ${median(baseline)}ms, current ${median(current)}ms; raw ${JSON.stringify({ baseline, current })}`);
	}
});
