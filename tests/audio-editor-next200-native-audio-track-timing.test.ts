/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeImportedVideoAudio } from '../src/common/editor/controller/import/internal/video-import-audio-decode.ts';
import { readVideoContainerAudioTiming } from '../src/common/editor/controller/import/internal/video-import-audio-timing.ts';
import { multipleAudioOriginFixture } from './browser/fixtures/multiple-audio-origin-fixture.ts';
import { nativeVideoAudioTailFixture } from './helpers/native-video-audio-tail-fixture.ts';

test('a single aligned programme retains its existing native path', async () => {
	const decoded = { channels: [new Float32Array(96_000).fill(.125)], sampleRate: 48_000 };
	let native = 0;
	const result = await decodeImportedVideoAudio({
		file: new Blob([new Uint8Array(nativeVideoAudioTailFixture(2))]), projectSampleRate: 48_000, durationSeconds: 2, hasAudio: true,
		inspectEncodedSampleRate: () => 48_000,
		decodeNative: async () => { native++; return decoded; },
		decodeContainerAudio: async () => { throw new Error('Unexpected container fallback'); },
		decodeFfmpeg: async () => { throw new Error('Unexpected FFmpeg fallback'); },
	});
	assert.equal(native, 1); assert.ok(result.decodedAudio === decoded);
});

test('multiple programmes with identical authenticated timing retain the native path', async () => {
	const decoded = { channels: [new Float32Array(96_000).fill(.125)], sampleRate: 48_000 };
	let native = 0;
	const file = new Blob([multipleAudioOriginFixture('aligned')]);
	const timing = await readVideoContainerAudioTiming(file);
	assert.equal(timing.nativeTimingShared, true);
	const result = await decodeImportedVideoAudio({
		file, projectSampleRate: 48_000, durationSeconds: 3, hasAudio: true,
		inspectEncodedSampleRate: () => { throw new Error('A file header cannot identify the native-selected programme rate'); },
		decodeNative: async () => { native++; return decoded; },
		decodeContainerAudio: async () => { throw new Error('Unexpected container fallback'); },
		decodeFfmpeg: async () => { throw new Error('Unexpected FFmpeg fallback'); },
	});
	assert.equal(native, 1); assert.ok(result.decodedAudio === decoded);
	assert.equal(result.declaredAudioSampleRate, null);
});

for (const variant of ['delayed-default', 'long-primary'] as const) {
	const duration = variant === 'long-primary' ? 5.499333333333333 : 3;
	const primary = () => {
		const samples = new Float32Array(Math.ceil(duration * 48_000));
		samples.fill(.25, 22_944, Math.min(samples.length, 22_944 + 48_000 * (variant === 'long-primary' ? 5 : 2)));
		return { channels: [samples], sampleRate: 48_000 };
	};
	const first = () => ({ channels: [new Float32Array(96_000).fill(.125)], sampleRate: 48_000 });
	test(`${variant}: an ambiguous native result never receives another programme's offset`, async () => {
		let container = 0;
		const result = await decodeImportedVideoAudio({
			file: new Blob([multipleAudioOriginFixture(variant)]), projectSampleRate: 48_000, durationSeconds: 3, hasAudio: true,
			inspectEncodedSampleRate: () => 48_000,
			decodeNative: async () => first(),
			decodeContainerAudio: async () => { container++; return primary(); },
			decodeFfmpeg: async () => { throw new Error('Unexpected FFmpeg fallback'); },
		});
		assert.equal(result.decodedAudio.channels?.[0]?.[28_800], .25);
		assert.equal(result.decodedAudio.channels?.[0]?.[4_800], 0);
		assert.equal(container, 1);
	});

	test(`${variant}: timestamp-aware container PCM retains its primary timing`, async () => {
		const placed = primary(); let container = 0;
		const result = await decodeImportedVideoAudio({
			file: new Blob([multipleAudioOriginFixture(variant)]), projectSampleRate: 48_000, durationSeconds: 3, hasAudio: true,
			inspectEncodedSampleRate: () => 48_000,
			decodeNative: async () => { throw new Error('Native unavailable'); },
			decodeContainerAudio: async (_file, options) => { container++; assert.equal(options.durationSeconds, duration); return placed; },
			decodeFfmpeg: async () => { throw new Error('Unexpected FFmpeg fallback'); },
		});
		assert.equal(container, 1); assert.ok(result.decodedAudio === placed);
		assert.equal(result.programmeFrameCount, variant === 'long-primary' ? 263_968 : undefined);
	});

	test(`${variant}: explicit first-track FFmpeg PCM retains first timing and extent`, async () => {
		const unplaced = first(); let ffmpeg = 0;
		const result = await decodeImportedVideoAudio({
			file: new Blob([multipleAudioOriginFixture(variant)]), projectSampleRate: 48_000, durationSeconds: 3, hasAudio: true,
			inspectEncodedSampleRate: () => 48_000,
			decodeNative: async () => { throw new Error('Native unavailable'); },
			decodeContainerAudio: async () => { throw new Error('Container unavailable'); },
			decodeFfmpeg: async () => { ffmpeg++; return unplaced; },
		});
		assert.equal(ffmpeg, 1);
		assert.equal(result.decodedAudio.channels?.[0]?.[4_800], .125);
		assert.ok(result.decodedAudio === unplaced, 'First starts at picture zero; no other programme may shift it.');
		assert.equal(result.programmeFrameCount, undefined, 'The other track must not extend the first programme.');
	});

	test(`${variant}: demux exposes explicit first and primary timing independently`, async () => {
		const file = new Blob([multipleAudioOriginFixture(variant)]);
		const firstTiming = await readVideoContainerAudioTiming(file, undefined, 'first');
		assert.equal(firstTiming.offsetSeconds, 0); assert.equal(firstTiming.programmeEndSeconds, 2);
		assert.equal(firstTiming.audioTrackCount, 2);
		const primaryTiming = await readVideoContainerAudioTiming(file);
		assert.equal(primaryTiming.offsetSeconds, .478); assert.equal(primaryTiming.audioTrackCount, 2);
		assert.equal(primaryTiming.nativeTimingShared, false);
	});
}
