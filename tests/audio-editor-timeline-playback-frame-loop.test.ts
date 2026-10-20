/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTimelinePlaybackFrameLoop,
	liveTimelinePositionFrame,
	lowRateTimelinePositionFrame,
	resolveTimelinePlaybackScroll,
} from '../src/common/editor/ui/timeline/timeline-playback-frame-loop.ts';

test('timeline playback frame loop owns one cancellable request chain', () => {
	let nextId = 1;
	let position = 120;
	const pending = new Map<number, FrameRequestCallback>();
	const cancelled: number[] = [];
	const rendered: number[] = [];
	const loop = createTimelinePlaybackFrameLoop({
		requestFrame(callback) {
			const id = nextId++;
			pending.set(id, (time) => {
				pending.delete(id);
				callback(time);
			});
			return id;
		},
		cancelFrame(id) {
			cancelled.push(id);
			pending.delete(id);
		},
		readPosition: () => position,
		renderPosition: (frame) => rendered.push(frame),
	});

	loop.start();
	loop.start();
	assert.deepEqual([...pending.keys()], [1]);
	pending.get(1)?.(0);
	assert.deepEqual(rendered, [120]);
	assert.deepEqual([...pending.keys()], [2]);
	position = 240;
	pending.get(2)?.(16);
	assert.deepEqual(rendered, [120, 240]);
	assert.deepEqual([...pending.keys()], [3]);
	loop.stop();
	assert.deepEqual(cancelled, [3]);
	loop.stop();
	loop.start();
	assert.deepEqual([...pending.keys()], [4]);
	loop.dispose();
	assert.deepEqual(cancelled, [3, 4]);
	loop.start();
	assert.equal(nextId, 5, 'disposed loops cannot restart');
});

test('interactive playhead position is exact when settled and bounded to four updates per second in motion', () => {
	const sampleRate = 48_000;
	assert.equal(lowRateTimelinePositionFrame({ positionFrame: 12_345, transportState: 'stopped' }, sampleRate), 12_345);
	assert.equal(lowRateTimelinePositionFrame({ positionFrame: 12_345, transportState: 'paused' }, sampleRate), 12_345);
	assert.equal(lowRateTimelinePositionFrame({ positionFrame: 12_345, transportState: 'playing' }, sampleRate), 12_000);
	assert.equal(lowRateTimelinePositionFrame({ positionFrame: 23_999, transportState: 'playing' }, sampleRate), 12_000);
	assert.equal(lowRateTimelinePositionFrame({ positionFrame: 24_000, transportState: 'recording' }, sampleRate), 24_000);
});

test('live playhead follows written frames during compacted recording and the engine otherwise', () => {
	const enginePosition = () => 48_000;
	assert.equal(liveTimelinePositionFrame({
		positionFrame: 100, transportState: 'recording', compactedRecording: true,
	}, enginePosition), 100);
	assert.equal(liveTimelinePositionFrame({
		positionFrame: 125, transportState: 'recording', compactedRecording: true,
	}, enginePosition), 125);
	assert.equal(liveTimelinePositionFrame({
		positionFrame: 100, transportState: 'recording', compactedRecording: false,
	}, enginePosition), 48_000);
	assert.equal(liveTimelinePositionFrame({
		positionFrame: 100, transportState: 'playing', compactedRecording: false,
	}, enginePosition), 48_000);
});

test('scroll-to-playhead advances by a page only after the playhead reaches the right edge', () => {
	assert.deepEqual(resolveTimelinePlaybackScroll({
		mode: 'page', playheadX: 999, scrollX: 0, viewportWidth: 1_000, leadingInset: 12,
	}), { suspended: false, targetScrollX: null });
	assert.deepEqual(resolveTimelinePlaybackScroll({
		mode: 'page', playheadX: 1_000, scrollX: 0, viewportWidth: 1_000, leadingInset: 12,
	}), { suspended: false, targetScrollX: 988 });
});

test('pinned playhead centers continuously while playback following is engaged', () => {
	assert.deepEqual(resolveTimelinePlaybackScroll({
		mode: 'pinned', playheadX: 760, scrollX: 100, viewportWidth: 1_000, leadingInset: 12,
	}), { suspended: false, targetScrollX: 260 });
});

test('manual scrolling suspends playback following until the playhead returns on screen', () => {
	for (const mode of ['page', 'pinned'] as const) {
		assert.deepEqual(resolveTimelinePlaybackScroll({
			mode, playheadX: 760, scrollX: 1_000, viewportWidth: 1_000, leadingInset: 12,
			suspended: true,
		}), { suspended: true, targetScrollX: null });
	}
	assert.deepEqual(resolveTimelinePlaybackScroll({
		mode: 'pinned', playheadX: 1_012, scrollX: 1_000, viewportWidth: 1_000, leadingInset: 12,
		suspended: true,
	}), { suspended: false, targetScrollX: 512 });
	assert.deepEqual(resolveTimelinePlaybackScroll({
		mode: 'page', playheadX: 1_012, scrollX: 1_000, viewportWidth: 1_000, leadingInset: 12,
		suspended: true,
	}), { suspended: false, targetScrollX: null });
});
