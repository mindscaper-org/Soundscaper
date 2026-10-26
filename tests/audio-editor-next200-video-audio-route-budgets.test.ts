/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeImportedVideoAudio } from '../src/common/editor/controller/import/internal/video-import-audio-decode.ts';
import { videoAudioRouteWorkloadFixture } from './browser/fixtures/video-audio-route-workload-fixture.ts';

// Allocation-boundary sentinels: never decode or construct900s PCM, including RED runs.
async function exercise(file: File, containerAvailable: boolean, rate = 48_000) {
	const calls = { native: 0, container: 0, ffmpeg: 0 }, durations: number[] = [];
	const small = { channels: [new Float32Array(16).fill(.125)], sampleRate: rate };
	let failure: unknown;
	const result = await decodeImportedVideoAudio({
		file, durationSeconds: 2, projectSampleRate: rate, nativeContextSampleRate: rate, hasAudio: true,
		inspectEncodedSampleRate: () => null,
		decodeNative: async () => { calls.native++; throw new Error('Unsafe whole-file native allocation requested'); },
		decodeContainerAudio: async (_file, options) => {
			calls.container++; durations.push(options.durationSeconds);
			if (!containerAvailable) throw new Error('Primary container decoder unavailable');
			return small;
		},
		decodeFfmpeg: async () => { calls.ffmpeg++; throw new Error('Unsafe whole-file FIRST allocation requested'); },
	}).catch((error: unknown) => { failure = error; return null; });
	return { calls, durations, result, small, failure };
}

test('shared900s programmes refuse the authored output before any decoder allocation', async () => {
	const observed = await exercise(videoAudioRouteWorkloadFixture('shared-long'), false);
	assert.equal(observed.calls.native, 0); assert.equal(observed.calls.container, 0); assert.equal(observed.calls.ffmpeg, 0);
	assert.equal(observed.failure instanceof RangeError, true);
});

test('an oversized unselected FIRST programme preserves the bounded2s primary container route', async () => {
	const observed = await exercise(videoAudioRouteWorkloadFixture('first-long'), true);
	assert.equal(observed.calls.native, 0); assert.equal(observed.calls.container, 1); assert.equal(observed.calls.ffmpeg, 0);
	assert.equal(observed.durations[0], 2); assert.equal(observed.result?.decodedAudio === observed.small, true);
	assert.equal(observed.result?.programmeFrameCount, undefined); assert.equal(observed.failure, undefined);
});

test('FIRST fallback checks its own900s output before leasing whole-file FFmpeg', async () => {
	const observed = await exercise(videoAudioRouteWorkloadFixture('first-long'), false);
	assert.equal(observed.calls.native, 0); assert.equal(observed.calls.container, 1); assert.equal(observed.calls.ffmpeg, 0);
	assert.equal(observed.failure instanceof RangeError, true);
});

test('shared authored2s edits retain bounded primary decode without whole coded900s allocation', async () => {
	const observed = await exercise(videoAudioRouteWorkloadFixture('shared-long', [2, 2]), true);
	assert.equal(observed.calls.native, 0); assert.equal(observed.calls.container, 1); assert.equal(observed.calls.ffmpeg, 0);
	assert.equal(observed.durations[0], 2); assert.equal(observed.result?.decodedAudio === observed.small, true);
	assert.equal(observed.result?.programmeFrameCount, undefined); assert.equal(observed.failure, undefined);
});

test('a short FIRST edit does not authorize whole coded900s FFmpeg work after primary failure', async () => {
	const observed = await exercise(videoAudioRouteWorkloadFixture('first-long', [2, 2]), false);
	assert.equal(observed.calls.native, 0); assert.equal(observed.calls.container, 1); assert.equal(observed.calls.ffmpeg, 0);
	assert.equal(observed.failure instanceof RangeError, true);
});

test('shared raw packet ends cannot bind native selection across different authored edits', async () => {
	// At an actual8k native/project clock the full coded candidate fits128MiB.
	// Selection still needs each programme's authored endpoint, independent of capacity.
	const observed = await exercise(videoAudioRouteWorkloadFixture('shared-long', [1, 5]), true, 8_000);
	assert.equal(observed.calls.native, 0); assert.equal(observed.calls.container, 1); assert.equal(observed.calls.ffmpeg, 0);
	assert.equal(observed.durations[0], 5); assert.equal(observed.result?.programmeFrameCount, 40_000);
	assert.equal(observed.result?.decodedAudio === observed.small, true); assert.equal(observed.failure, undefined);
});
