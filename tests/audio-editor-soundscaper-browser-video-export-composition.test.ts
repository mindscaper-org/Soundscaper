/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeVideoKeyframeOfflineVideo } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import {
	encodeVideoKeyframeVideo,
	type VideoKeyframeVideoEncoderDependencies,
} from '../src/common/editor/video-keyframe-video-encoder.ts';
import {
	exportFixture,
	harnessDependencies,
	RATE,
	SOURCE_ID,
} from './helpers/video-keyframe-offline-export-harness.ts';

const MP4 = Uint8Array.of(
	0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
	0, 0, 0, 9, 0x6d, 0x6f, 0x6f, 0x76, 0,
	0, 0, 0, 9, 0x6d, 0x64, 0x61, 0x74, 0,
);

test('keyed browser composition reaches WebCodecs without an FFmpeg operation owner', async () => {
	const fixture = await exportFixture();
	const events: string[] = [];
	let nativeExecutions = 0;
	const nativeDependencies: VideoKeyframeVideoEncoderDependencies = Object.freeze({
		createJobToken: () => 'abcdef0123456789abcdef0123456789',
		async executeBrowserWebCodecs(
			request: Parameters<NonNullable<VideoKeyframeVideoEncoderDependencies['executeBrowserWebCodecs']>>[0],
		) {
			nativeExecutions += 1;
			const bytes = MP4.slice();
			return Object.freeze({
				bytes,
				byteLength: bytes.byteLength,
				videoEncoder: 'webcodecs' as const,
				codec: request.webCodecs.codec,
				frameCount: request.workload.frameCount,
				frameBytes: request.workload.frameBytes,
				totalRgbaBytes: request.workload.totalRgbaBytes,
				videoByteLength: bytes.byteLength,
				chunkCount: 1,
				format: 'mp4' as const,
				extension: '.mp4' as const,
				mimeType: 'video/mp4' as const,
				decoderConfigObserved: true,
			});
		},
	});
	const offlineDependencies = harnessDependencies(events, {
		encode: (editorFfmpeg, request) => {
			events.push('encode:native');
			return encodeVideoKeyframeVideo(editorFfmpeg, request, nativeDependencies);
		},
	});
	const restoreGlobals = installWebCodecsGlobals();
	try {
		const result = await encodeVideoKeyframeOfflineVideo({
			project: fixture.project,
			timingBySourceId: fixture.timing,
			sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
			canvas: { width: 64, height: 32, frameRate: RATE },
			format: 'mp4',
			webCodecs: { codec: 'avc1.4d001f', bitrate: 100_000 },
			signal: new AbortController().signal,
			assertCurrent() {},
			maximumOutputBytes: 1_024 * 1_024,
		}, offlineDependencies);

		assert.equal(result.videoEncoder, 'webcodecs');
		assert.equal(result.codec, 'avc1.4d001f');
		assert.deepEqual([...result.bytes], [...MP4]);
		assert.equal(nativeExecutions, 1);
		assert.ok(events.includes('encode:native'));
	} finally {
		restoreGlobals();
	}
});

test('offline desktop composition still requires the owned FFmpeg operation port', async () => {
	const fixture = await exportFixture();
	const events: string[] = [];
	await assert.rejects(encodeVideoKeyframeOfflineVideo({
		project: fixture.project,
		timingBySourceId: fixture.timing,
		sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
		canvas: { width: 64, height: 32, frameRate: RATE },
		format: 'mp4',
		editorFfmpeg: {} as never,
		signal: new AbortController().signal,
		assertCurrent() {},
	}, harnessDependencies(events)), /FFmpeg owner\.runVideoKeyframeEncoderOperation/u);
	assert.deepEqual(events, []);
});

function installWebCodecsGlobals(): () => void {
	const encoder = Object.getOwnPropertyDescriptor(globalThis, 'VideoEncoder');
	const frame = Object.getOwnPropertyDescriptor(globalThis, 'VideoFrame');
	Object.defineProperty(globalThis, 'VideoEncoder', {
		configurable: true,
		writable: true,
		value: class VideoEncoder {},
	});
	Object.defineProperty(globalThis, 'VideoFrame', {
		configurable: true,
		writable: true,
		value: class VideoFrame {},
	});
	return () => {
		if (encoder) Object.defineProperty(globalThis, 'VideoEncoder', encoder);
		else Reflect.deleteProperty(globalThis, 'VideoEncoder');
		if (frame) Object.defineProperty(globalThis, 'VideoFrame', frame);
		else Reflect.deleteProperty(globalThis, 'VideoFrame');
	};
}
