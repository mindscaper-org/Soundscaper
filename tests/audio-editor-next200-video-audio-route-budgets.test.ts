/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferSource, Input, MP4 } from 'mediabunny';
import { decodeImportedVideoAudio } from '../src/common/editor/controller/import/internal/video-import-audio-decode.ts';
import { videoAudioRouteWorkloadFixture } from './browser/fixtures/video-audio-route-workload-fixture.ts';

// Allocation-boundary sentinels: never decode or construct900s PCM, including RED runs.
async function exercise(file: File, containerAvailable: boolean, rate = 48_000, mode: 'legacy' | 'selected' = 'legacy') {
	const calls = { native: 0, container: 0, ffmpeg: 0 }, durations: number[] = [];
	const small = { channels: [new Float32Array(16).fill(.125)], sampleRate: rate };
	let failure: unknown;
	const result = await decodeImportedVideoAudio({
		file, durationSeconds: 2, projectSampleRate: rate, nativeContextSampleRate: rate, hasAudio: true,
		...(mode === 'legacy' ? { audioProgramme: 'legacy' as const } : {}),
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

for (const mode of ['legacy', 'selected'] as const) test(`${mode} 900-second programmes refuse the output before any decoder allocation`, async () => {
	const observed = await exercise(videoAudioRouteWorkloadFixture('shared-long'), false, 48_000, mode);
	assert.equal(observed.calls.native, 0); assert.equal(observed.calls.container, 0); assert.equal(observed.calls.ffmpeg, 0);
	assert.equal(observed.failure instanceof RangeError, true);
});

test('the selected short AAC programme opens natively without the oversized disabled programme', async () => {
	const file = videoAudioRouteWorkloadFixture('first-long');
	const samples = new Float32Array(96_000).fill(.125);
	const result = await decodeImportedVideoAudio({
		file, durationSeconds: 2, projectSampleRate: 48_000, nativeContextSampleRate: 48_000, hasAudio: true,
		inspectEncodedSampleRate: () => assert.fail('The selected track already supplies its sample rate.'),
		async decodeNative(encoded) {
			const input = new Input({ source: new BufferSource(encoded), formats: [MP4] });
			try {
				const tracks = await input.getAudioTracks();
				assert.equal(tracks.length, 1, 'The long disabled programme must be absent from the decode view.');
				assert.equal(await tracks[0]!.computeDuration(), 2);
				return { channels: [samples], sampleRate: 48_000 };
			} finally { input.dispose(); }
		},
		async decodeContainerAudio() { return assert.fail('The short selected programme should remain on the native route.'); },
		async decodeFfmpeg() { return assert.fail('The disabled programme must not reach the fallback decoder.'); },
	});
	assert.equal(result.selectedAudioStreamIndex, 2);
	assert.equal(result.decodedAudio.channels?.[0]?.buffer, samples.buffer);
	assert.equal(result.decodedAudio.channels?.[0]?.length, 96_000);
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
