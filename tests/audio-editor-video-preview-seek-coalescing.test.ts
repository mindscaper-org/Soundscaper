/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { cancelVideoPreviewMediaSeek, hasPendingVideoPreviewMediaSeek } from '../src/common/editor/controller/clip-video/video-preview-media-seek.ts';
import { primeVideoPreviewCompositorPool, synchronizeVideoPreviewCompositorLayers } from '../src/common/editor/ui/workspace/video-preview-compositor-pool.js';
import { areVideoPreviewMediaLayersReadyForExactRender } from '../src/common/editor/ui/workspace/video-preview-exact-render-policy.ts';
import { synchronizeVideoPreviewMedia } from '../src/common/editor/ui/workspace/video-preview-retime.ts';

class SeekingVideo extends EventTarget {
	#time = 0;
	seeking = false;
	playbackRate = 1;
	readyState = 4;
	synchronous = false;
	failNext = false;
	readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	paused = true;
	src = 'blob:original';
	currentSrc = 'blob:original';
	srcObject: unknown = null;
	readonly assignments: number[] = [];
	get currentTime(): number { return this.#time; }
	set currentTime(value: number) {
		if (this.failNext) { this.failNext = false; throw new Error('Metadata unavailable'); }
		this.#time = value;
		this.assignments.push(value);
		this.seeking = true;
		if (this.synchronous) this.drain();
	}
	addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
		if (callback) {
			const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
			listeners.add(callback);
			this.listeners.set(type, listeners);
		}
		super.addEventListener(type, callback, options);
	}
	removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
		if (callback) this.listeners.get(type)?.delete(callback);
		super.removeEventListener(type, callback, options);
	}
	listenerCount(): number { return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0); }
	pause(): void { this.paused = true; }
	play(): Promise<void> { this.paused = false; return Promise.resolve(); }
	drain(): void { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
}

function seek(video: SeekingVideo, seconds: number, exact = false): void {
	synchronizeVideoPreviewMedia(video, {
		sourceTimeSeconds: seconds, exactPresentation: exact,
	}, 1, 'stopped');
}

test('rapid paused preview seeks let the decoder finish before seeking to the latest target', () => {
	const video = new SeekingVideo();
	for (let target = 1; target <= 100; target += 1) seek(video, target);
	assert.deepEqual(video.assignments, [1]);
	video.drain();
	assert.deepEqual(video.assignments, [1, 100]);
	video.drain();
	assert.deepEqual(video.assignments, [1, 100]);
});

test('returning to the in-flight target discards the superseded queued target', () => {
	const video = new SeekingVideo();
	seek(video, 1, true);
	seek(video, 2, true);
	seek(video, 1, true);
	assert.deepEqual(video.assignments, [1]);
	video.drain();
	assert.deepEqual(video.assignments, [1]);
});

test('changing the media source prevents an old queued seek from reaching its replacement', () => {
	const video = new SeekingVideo();
	seek(video, 1);
	seek(video, 2);
	video.src = 'blob:replacement';
	video.currentSrc = video.src;
	video.drain();
	assert.deepEqual(video.assignments, [1]);
	seek(video, 3);
	assert.deepEqual(video.assignments, [1, 3]);
});

test('media load cancellation discards queued preview seeks', () => {
	for (const event of ['loadstart', 'emptied', 'error', 'abort']) {
		const video = new SeekingVideo();
		seek(video, 1);
		seek(video, 2);
		video.dispatchEvent(new Event(event));
		video.drain();
		assert.deepEqual(video.assignments, [1], event);
	}
});


test('retiring a preview cancels every deferred listener idempotently', () => {
	const video = new SeekingVideo();
	seek(video, 1);
	seek(video, 2);
	assert.equal(video.listenerCount(), 5);
	assert.equal(hasPendingVideoPreviewMediaSeek(video), true);
	cancelVideoPreviewMediaSeek(video);
	cancelVideoPreviewMediaSeek(video);
	assert.equal(video.listenerCount(), 0);
	assert.equal(hasPendingVideoPreviewMediaSeek(video), false);
	video.drain();
	assert.deepEqual(video.assignments, [1]);
});

test('synchronous completion of the latest seek leaves no queued work or listeners', () => {
	const video = new SeekingVideo();
	seek(video, 1);
	seek(video, 2);
	video.synchronous = true;
	video.drain();
	assert.deepEqual(video.assignments, [1, 2]);
	assert.equal(video.seeking, false);
	assert.equal(video.listenerCount(), 0);
	assert.equal(hasPendingVideoPreviewMediaSeek(video), false);
	assert.equal(areVideoPreviewMediaLayersReadyForExactRender([{ entries: [{ video }] }]), true);
});

test('a superseded decoded picture stays unavailable to exact rendering until its latest seek drains', () => {
	const video = new SeekingVideo();
	const layers = [{ entries: [{ video }] }];
	seek(video, 1);
	seek(video, 2);
	video.seeking = false;
	assert.equal(areVideoPreviewMediaLayersReadyForExactRender(layers), false);
	video.drain();
	assert.equal(areVideoPreviewMediaLayersReadyForExactRender(layers), false);
	video.drain();
	assert.equal(areVideoPreviewMediaLayersReadyForExactRender(layers), true);
});

test('metadata rejection of a drained seek removes listeners and permits a later retry', () => {
	const video = new SeekingVideo();
	seek(video, 1);
	seek(video, 2);
	video.failNext = true;
	video.drain();
	assert.equal(video.listenerCount(), 0);
	assert.equal(hasPendingVideoPreviewMediaSeek(video), false);
	seek(video, 2);
	assert.deepEqual(video.assignments, [1, 2]);
});

test('playing within drift tolerance cancels an older queued paused target', () => {
	const video = new SeekingVideo();
	seek(video, 1);
	seek(video, 2);
	synchronizeVideoPreviewMedia(video, { sourceTimeSeconds: 1.04 }, 1, 'playing');
	video.drain();
	assert.deepEqual(video.assignments, [1]);
	assert.equal(video.paused, false);
});

test('a new request after source replacement owns the new source queue', () => {
	const video = new SeekingVideo();
	seek(video, 1);
	seek(video, 2);
	video.srcObject = {};
	seek(video, 3);
	video.drain();
	assert.deepEqual(video.assignments, [1, 3]);
	assert.equal(video.listenerCount(), 0);
});


test('the exact compositor and paused preview share one latest-target seek queue', () => {
	const video = Object.assign(new SeekingVideo(), { videoWidth: 640, videoHeight: 360 });
	const layerPool: object[] = [];
	const targetLayers: object[] = [];
	primeVideoPreviewCompositorPool(layerPool, 1);
	const timeline = {
		clipStateById: new Map([['clip', { available: true }]]),
		intervals: [{
			kind: 'composition', timelineStartFrame: 0, timelineEndFrame: 101,
			layers: [{ trackId: 'video-track', clips: [{
				clipId: 'clip', role: 'single', clip: { videoEffects: [] },
				source: { id: 'source', width: 640, height: 360 }, opacityStart: 1, opacityEnd: 1,
			}] }],
		}],
		resolveClipPresentation: ({ timelineSample }: { timelineSample: number }) => ({
			sourceTime: { numerator: BigInt(timelineSample), denominator: 1n },
		}),
	};
	seek(video, 1);
	for (let target = 2; target <= 100; target += 1) {
		synchronizeVideoPreviewCompositorLayers(targetLayers, layerPool, timeline, target,
			new Map([['clip', video]]), { effectsFor: (_id: string, effects: object) => effects }, new Map());
	}
	assert.deepEqual(video.assignments, [1]);
	video.drain();
	assert.deepEqual(video.assignments, [1, 100]);
	assert.equal(video.paused, true);
	assert.equal(video.listenerCount(), 0);
});
