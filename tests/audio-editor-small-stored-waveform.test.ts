/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { generateStoredWaveformPeaks, generateWaveformPeaks } from '../src/common/editor/controller/source/waveform-analysis.ts';

const copy = { audioAnalysisWorkerFailed: 'worker failed', audioAnalysisFailed: 'analysis failed' };

function rejectWorkerStartup(context: TestContext): void {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class {
		constructor() { throw new Error('unexpected worker startup'); }
	} });
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, 'Worker', previous);
		else Reflect.deleteProperty(globalThis, 'Worker');
	});
}

test('tiny in-memory sources use the same bounded waveform path', async context => {
	rejectWorkerStartup(context);
	const peaks = await generateWaveformPeaks([Float32Array.of(-.5, .5)], copy);
	assert.deepEqual([...peaks.levels[0]!.channels[0]!.rms], [.5]);
});

test('tiny stored sources retain exact stereo peaks without starting a worker per source', async context => {
	rejectWorkerStartup(context);
	const channels = [Float32Array.of(-.5, .5), Float32Array.of(1, -1)];
	const peaks = await generateStoredWaveformPeaks({ async *readSourceChunks(key) {
		assert.equal(key, 'retained-pcm');
		yield { channels, frames: 2 };
	} }, { id: 'source', storageKey: 'retained-pcm', frameCount: 2, channelCount: 2 }, copy);
	assert.equal(peaks.channelCount, 2);
	assert.ok(peaks.levels.length > 0);
	for (const level of peaks.levels) {
		assert.deepEqual([...level.channels[0]!.minimums], [-.5]);
		assert.deepEqual([...level.channels[0]!.maximums], [.5]);
		assert.deepEqual([...level.channels[0]!.rms], [.5]);
		assert.deepEqual([...level.channels[1]!.minimums], [-1]);
		assert.deepEqual([...level.channels[1]!.maximums], [1]);
		assert.deepEqual([...level.channels[1]!.rms], [1]);
	}
	assert.deepEqual(channels.map(channel => [...channel]), [[-.5, .5], [1, -1]]);
});

test('local stored waveform work is bounded by samples across all channels', async context => {
	rejectWorkerStartup(context);
	const store = { async *readSourceChunks() {
		yield { channels: [new Float32Array(8_192).fill(.25), new Float32Array(8_192).fill(-.5)], frames: 8_192 };
	} };
	const source = { id: 'source', frameCount: 8_192, channelCount: 2 };
	const peaks = await generateStoredWaveformPeaks(store, source, copy);
	assert.equal(peaks.levels[0]!.channels[0]!.maximums[0], .25);
	assert.equal(peaks.levels[0]!.channels[1]!.rms[0], .5);
	await assert.rejects(generateStoredWaveformPeaks(store, { ...source, channelCount: 3 }, copy), /unexpected worker startup/u);
});

test('small stored waveform preparation still observes cancellation between chunks', async context => {
	rejectWorkerStartup(context);
	const controller = new AbortController();
	let pulled = 0;
	await assert.rejects(generateStoredWaveformPeaks({ async *readSourceChunks() {
		pulled += 1;
		yield { channels: [Float32Array.of(-.5, .5)], frames: 2 };
		pulled += 1;
		yield { channels: [Float32Array.of(-.5, .5)], frames: 2 };
	} }, { id: 'source', frameCount: 4, channelCount: 1 }, copy, {
		signal: controller.signal,
		onProgress() { controller.abort(); },
	}), { name: 'AbortError' });
	assert.equal(pulled, 1);
});
