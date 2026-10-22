/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { synchronizeVideoPreviewMedia } from '../src/common/editor/ui/workspace/video-preview-retime.ts';

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

function media() {
	return { currentTime: 0, playbackRate: 1, pauses: 0, plays: 0,
		pause() { this.pauses += 1; }, async play() { this.plays += 1; } };
}
