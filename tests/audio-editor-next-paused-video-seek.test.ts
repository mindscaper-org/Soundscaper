/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { synchronizeVideoPreviewMedia } from '../src/common/editor/ui/workspace/video-preview-retime.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';

for (const state of ['paused', 'stopped']) test(`ordinary ${state} preview follows small forward and backward seeks`, () => {
	const video = media();
	synchronizeVideoPreviewMedia(video, { sourceTimeSeconds: 2 / 30 }, 1, state);
	assert.equal(video.currentTime, 2 / 30, 'two sequence frames must not be discarded as playback drift');
	synchronizeVideoPreviewMedia(video, { sourceTimeSeconds: 1 / 30 }, 1, state);
	assert.equal(video.currentTime, 1 / 30, 'one frame backward must present the earlier picture');
	assert.equal(video.pauses, 2);
	assert.equal(video.plays, 0);
});

test('continuous playback keeps its drift tolerance while exact retimed playback stays frame-addressed', () => {
	const video = media();
	synchronizeVideoPreviewMedia(video, { sourceTimeSeconds: 2 / 30, playbackRate: 2 }, 0.5, 'playing');
	assert.equal(video.currentTime, 0);
	assert.equal(video.playbackRate, 1);
	assert.equal(video.plays, 1);
	synchronizeVideoPreviewMedia(video, { sourceTimeSeconds: 2 / 30, exactPresentation: true }, 1, 'playing');
	assert.equal(video.currentTime, 2 / 30);
	assert.equal(video.pauses, 1);
	assert.equal(video.plays, 1);
});

test('paused preview seeks early within the registered picture without retiming continuous playback', () => {
	const video = media();
	const source = { id: 'indexed-preview', contentSha256: 'd'.repeat(64) };
	registerVideoTimingIndex(source, {
		timescale: 25, frameCount: 4, presentationTicks: [0n, 1n, 2n, 3n],
		finalFrameDurationTicks: 1n, endTicks: 4n,
	});
	try {
		synchronizeVideoPreviewMedia(video, { source, sourceTimeSeconds: 0.128 }, 1, 'playing');
		assert.equal(video.currentTime, 0.128);
		synchronizeVideoPreviewMedia(video, { source, sourceTimeSeconds: 0.064 }, 1, 'paused');
		assert.equal(video.currentTime, 0.05);
		synchronizeVideoPreviewMedia(video, { source, sourceTimeSeconds: 0.032 }, 1, 'stopped');
		assert.equal(video.currentTime, 0.01);
	} finally { unregisterVideoTimingIndex(source); }
});

function media() {
	return { currentTime: 0, playbackRate: 1, pauses: 0, plays: 0,
		pause() { this.pauses += 1; }, async play() { this.plays += 1; } };
}
