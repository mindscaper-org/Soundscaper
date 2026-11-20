/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { BlobSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';
import { prepareFragmentPlaybackView, prepareQualifiedFragmentPlaybackView } from '../src/common/editor/video-source-monitor-fragment-view.ts';
import { createVideoPicturePlaybackUrls } from '../src/common/editor/controller/document/internal/video-picture-playback-urls.ts';
import { demuxVideoTiming } from '../src/common/editor/video-timing-demux.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { sourceMonitorFragmentedMedia } from './browser/fixtures/video-timing-probe-media.js';
import { hybridAv1VideoFixture } from './browser/fixtures/video-hybrid-av1.js';
import { videoOnlyFragmentedAvcFixture } from './browser/fixtures/video-only-fragmented-avc.js';

async function pictureBodies(file: Blob): Promise<string[]> {
	const input = new Input({ formats: [MP4], source: new BlobSource(file) });
	try {
		const track = await input.getPrimaryVideoTrack();
		assert.ok(track);
		const frames: string[] = [];
		for await (const packet of new EncodedPacketSink(track).packets()) {
			frames.push(createHash('sha256').update(packet.data).digest('hex'));
		}
		return frames;
	} finally { input.dispose(); }
}

test('Source Monitor fragment views retain all authored timings and original encoded AVC pictures', async () => {
	const files = sourceMonitorFragmentedMedia().map(file => new File([Uint8Array.from(file.buffer)], file.name, { type: file.mimeType }));
	const [classic, ...fragmented] = files;
	assert.ok(classic);
	const { presentationTicks, finalFrameDurationTicks, timescale } = await demuxVideoTiming(classic);
	const timing = { finalFrameDurationTicks, timescale, frameCount: presentationTicks.length,
		presentationTick: (ordinal: number) => presentationTicks[ordinal] };
	const signal = new AbortController().signal;
	assert.equal(await prepareFragmentPlaybackView(classic, timing, signal), null);
	const expected = await pictureBodies(classic);
	assert.equal(expected.length, 22);
	for (const file of fragmented) {
		const view = await prepareFragmentPlaybackView(file, timing, signal, { standardSampleEntry: true });
		assert.ok(view);
		const candidate = await demuxVideoTiming(view);
		assert.deepEqual(candidate.presentationTicks, presentationTicks);
		assert.equal(candidate.finalFrameDurationTicks, finalFrameDurationTicks);
		assert.deepEqual(await pictureBodies(view), expected);
		assert.equal(await prepareFragmentPlaybackView(file, { ...timing, frameCount: 21 }, signal), null);
		assert.equal(await prepareFragmentPlaybackView(file, timing, signal, { maximumBytes: 1024 }), null);
	}
});

test('owned Programme can normalize a complete video-only fragment picture clock', async () => {
	const [fragment, fragmentWithAudio] = [videoOnlyFragmentedAvcFixture(), sourceMonitorFragmentedMedia()[1]!]
		.map(({ buffer, mimeType }) => new Blob([Uint8Array.from(buffer)], { type: mimeType }));
	const original = fragment!;
	const withAudio = fragmentWithAudio!;
	const blobs = new Map<string, Blob>();
	const playback = createVideoPicturePlaybackUrls({
		createObjectURL(body) { blobs.set('fragment-picture', body); return 'fragment-picture'; },
		revokeObjectURL(url) { blobs.delete(url); },
	});
	const indexFor = async (blob: Blob) => {
		const sourceDigest = createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex');
		const timing = createVideoTimingAssetPublication(sourceDigest, await demuxVideoTiming(blob));
		return validateVideoTimingAssetBytes(timing.reference, timing.bytes);
	};
	const timing = await indexFor(original);
	const projection = await prepareQualifiedFragmentPlaybackView(original, {
		...timing, presentationTick: ordinal => timing.presentationTicks[ordinal],
	}, new AbortController().signal,
		{ programmePicture: true, standardSampleEntry: true });
	assert.ok(projection);
	assert.equal(projection.compositionShiftSeconds, 6_000 / 90_000);
	const url = await playback.create(original, timing);
	assert.equal(url, 'fragment-picture');
	const view = blobs.get(url)!;
	const actual = await demuxVideoTiming(view);
	assert.deepEqual(actual.presentationTicks, timing.presentationTicks);
	assert.equal(actual.timescale, timing.timescale);
	assert.equal(actual.finalFrameDurationTicks, timing.finalFrameDurationTicks);
	assert.deepEqual(await pictureBodies(view), await pictureBodies(original));
	assert.equal(await playback.create(withAudio, await indexFor(withAudio)), null);
	playback.revoke(url);
	assert.equal(blobs.size, 0);
});

test('hybrid AV1 playback keeps all authored packets and requires its original decoder configuration', async () => {
	const { buffer, mimeType } = hybridAv1VideoFixture();
	const asFile = (bytes: Buffer) => new Blob([Uint8Array.from(bytes)], { type: mimeType });
	const file = asFile(buffer);
	const original = await demuxVideoTiming(file);
	const timing = { ...original, frameCount: original.presentationTicks.length,
		presentationTick: (ordinal: number) => original.presentationTicks[ordinal] };
	const signal = new AbortController().signal;
	const view = await prepareFragmentPlaybackView(file, timing, signal, { standardSampleEntry: true, programmePicture: true });
	assert.ok(view);
	const projected = await demuxVideoTiming(view);
	assert.equal(projected.timescale, original.timescale);
	assert.equal(projected.finalFrameDurationTicks, original.finalFrameDurationTicks);
	assert.deepEqual(projected.presentationTicks, original.presentationTicks);
	const pictures = await pictureBodies(view);
	assert.equal(pictures.length, 23);
	// SHA-256 of all original packet SHA-256 strings from ffprobe, in coded order.
	assert.equal(createHash('sha256').update(pictures.join('')).digest('hex'),
		'b3bba3296cd525ddea1ea988712659d70d97f854293d91fd4a8829a3259043bf');
	const av1Configuration = buffer.indexOf('av1C');
	assert.ok(av1Configuration > 0);
	const patched = (offset: number, value: number) => {
		const copy = Buffer.from(buffer);
		copy[offset] = value;
		return asFile(copy);
	};
	const flags = av1Configuration + 7;
	const obu = av1Configuration + 10;
	assert.equal(await prepareFragmentPlaybackView(patched(flags, 0x10), timing, signal), null);
	assert.equal(await prepareFragmentPlaybackView(patched(obu, buffer[obu]! ^ 1), timing, signal), null);
});
