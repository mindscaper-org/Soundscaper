/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoThumbnailKeyframeSelector } from '../src/common/editor/video-thumbnail-keyframes.ts';
import { BlobSource, BufferTarget, EncodedPacketSink, EncodedVideoPacketSource, Input, MP4, Mp4OutputFormat, Output } from 'mediabunny';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';

test('the production MP4 index finds surrounding I-frames without decoding intervening pictures', async () => {
	const fixture = videoTimingProbeMedia.find(value => value.kind === 'cfr')!;
	const input = new Input({ source: new BlobSource(new Blob([Uint8Array.from(fixture.file.buffer)])), formats: [MP4] });
	try {
		const track = await input.getPrimaryVideoTrack(); assert.ok(track);
		const config = await track.getDecoderConfig(); assert.ok(config);
		const codec = await track.getCodec(); assert.ok(codec);
		const packet = await new EncodedPacketSink(track).getFirstKeyPacket(); assert.ok(packet);
		const target = new BufferTarget();
		const output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
		const video = new EncodedVideoPacketSource(codec);
		output.addVideoTrack(video); await output.start();
		for (const timestamp of [0, 4, 8]) await video.add(packet.clone({ timestamp, duration: 4 }), { decoderConfig: config });
		await output.finalize(); assert.ok(target.buffer);
		const selector = createVideoThumbnailKeyframeSelector(new Blob([target.buffer], { type: 'video/mp4' }));
		try {
			assert.equal(await selector.nearest(5, 12), 4);
			assert.equal(await selector.nearest(7, 12), 8);
		} finally { selector.dispose(); }
	} finally { input.dispose(); }
});

test('filmstrip requests select the closest surrounding keyframe with earlier ties', async () => {
	let opened = 0, disposed = 0;
	const selector = createVideoThumbnailKeyframeSelector(new Blob(['video']), {
		openIndex: async () => { opened++; return { neighbours: async () => [4, 8], dispose() { disposed++; } }; },
	});
	assert.equal(opened, 0, 'Ordinary exact captures must not open a thumbnail index.');
	assert.equal(await selector.nearest(5, 10), 4);
	assert.equal(await selector.nearest(7, 10), 8);
	assert.equal(await selector.nearest(6, 10), 4);
	assert.equal(opened, 1);
	selector.dispose(); selector.dispose();
	assert.equal(disposed, 1);
});

test('missing or invalid keyframes preserve the requested exact capture time', async () => {
	const selector = createVideoThumbnailKeyframeSelector(new Blob(['video']), {
		openIndex: async () => ({ neighbours: async () => [-1, NaN, Infinity, 10], dispose() {} }),
	});
	assert.equal(await selector.nearest(5, 10), 5);
	selector.dispose();
	let attempts = 0;
	const unavailable = createVideoThumbnailKeyframeSelector(new Blob(['video']), {
		openIndex: () => { attempts++; return Promise.reject(new Error('No keyframe index.')); },
	});
	assert.equal(await unavailable.nearest(5, 10), 5);
	assert.equal(await unavailable.nearest(7, 10), 7);
	assert.equal(attempts, 1);
	unavailable.dispose();
});

test('disposal fences a late index and releases its native reader once', async () => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	let disposed = 0;
	const selector = createVideoThumbnailKeyframeSelector(new Blob(['video']), {
		openIndex: async () => { await gate; return { neighbours: async () => [4], dispose() { disposed++; } }; },
	});
	const pending = selector.nearest(5, 10);
	selector.dispose();
	release();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(disposed, 1);
});

test('cancellation stops a pending keyframe lookup instead of waiting for media I/O', async () => {
	const abort = new AbortController();
	let entered!: () => void;
	const started = new Promise<void>(resolve => { entered = resolve; });
	const selector = createVideoThumbnailKeyframeSelector(new Blob(['video']), {
		openIndex: async () => ({ neighbours: () => { entered(); return new Promise<readonly number[]>(() => {}); }, dispose() {} }),
	});
	const pending = selector.nearest(5, 10, abort.signal);
	await started;
	abort.abort(new DOMException('Project changed.', 'AbortError'));
	await assert.rejects(pending, /Project changed/u);
	selector.dispose();
});
