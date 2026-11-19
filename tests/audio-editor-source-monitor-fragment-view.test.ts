/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { BlobSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';
import { prepareFragmentPlaybackView } from '../src/common/editor/video-source-monitor-fragment-view.ts';
import { demuxVideoTiming } from '../src/common/editor/video-timing-demux.ts';
import { sourceMonitorFragmentedMedia } from './browser/fixtures/video-timing-probe-media.js';

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
