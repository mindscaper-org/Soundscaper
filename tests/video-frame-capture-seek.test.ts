/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';

import { seekVideoFrameForCapture } from '../src/common/editor/video-frame-capture-seek.ts';

class NativeVideo extends EventTarget {
	private time = 0;
	private nextCallback = 0;
	seeking = false;
	readonly callbacks = new Map<number, VideoFrameRequestCallback>();
	get currentTime(): number { return this.time; }
	set currentTime(value: number) { this.time = value; this.seeking = true; }
	requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
		const id = ++this.nextCallback; this.callbacks.set(id, callback); return id;
	}
	cancelVideoFrameCallback(id: number): void { this.callbacks.delete(id); }
	completeSeek(): void { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
	presentFrame(): void {
		const callbacks = [...this.callbacks.values()]; this.callbacks.clear();
		const metadata = { expectedDisplayTime: 0, height: 16, mediaTime: this.time,
			presentationTime: 0, presentedFrames: 1, width: 16 };
		for (const callback of callbacks) callback(0, metadata);
	}
}

function assertReleased(video: NativeVideo, signal?: AbortSignal): void {
	assert.equal(video.callbacks.size, 0);
	for (const event of ['seeked', 'error']) assert.equal(getEventListeners(video, event).length, 0);
	if (signal) assert.equal(getEventListeners(signal, 'abort').length, 0);
}

test('native capture waits for presented pixels after the seek event', async () => {
	const video = new NativeVideo(); let ready = false;
	const pending = seekVideoFrameForCapture(video, .4, { timeoutMs: 1_000 }).then(() => { ready = true; });
	video.completeSeek();
	await Promise.resolve();
	assert.equal(ready, false, 'seeked alone must not release canvas capture');
	assert.equal(video.callbacks.size, 1);
	video.presentFrame(); await pending;
	assert.equal(ready, true); assertReleased(video);
});

test('a stale presentation during the seek does not release capture', async () => {
	const video = new NativeVideo(); let ready = false;
	const pending = seekVideoFrameForCapture(video, .7, { timeoutMs: 1_000 }).then(() => { ready = true; });
	video.presentFrame(); video.completeSeek(); await Promise.resolve();
	assert.equal(ready, false); assert.equal(video.callbacks.size, 1);
	video.presentFrame(); await pending;
	assert.equal(ready, true);
});

test('a completed native presentation can precede dispatch of the seek event', async () => {
	const video = new NativeVideo(); let ready = false;
	const pending = seekVideoFrameForCapture(video, .4, { timeoutMs: 1_000 }).then(() => { ready = true; });
	video.seeking = false; video.presentFrame(); await Promise.resolve();
	assert.equal(ready, false);
	video.completeSeek(); await pending; assertReleased(video);
});

test('abort and decoder failure cancel presentation callbacks', async () => {
	for (const failure of ['abort', 'decoder'] as const) {
		const video = new NativeVideo(); const abort = new AbortController();
		const pending = seekVideoFrameForCapture(video, .4, { timeoutMs: 1_000, signal: abort.signal });
		video.completeSeek();
		if (failure === 'abort') abort.abort(); else video.dispatchEvent(new Event('error'));
		await assert.rejects(pending, failure === 'abort' ? { name: 'AbortError' } : /could not seek/u);
		assertReleased(video, abort.signal);
	}
	const video = new NativeVideo(); const abort = new AbortController(); abort.abort();
	await assert.rejects(seekVideoFrameForCapture(video, .4, { timeoutMs: 1_000, signal: abort.signal }), { name: 'AbortError' });
	assert.equal(video.currentTime, 0); assertReleased(video, abort.signal);
});

test('a missing native presentation times out and releases its callback', async () => {
	const video = new NativeVideo();
	const pending = seekVideoFrameForCapture(video, .4, { timeoutMs: 1 }); video.completeSeek();
	await assert.rejects(pending, /Timed out.*video frame/u);
	assertReleased(video);
});

test('zero timeout permits a later asynchronous native presentation', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const video = new NativeVideo(); let ready = false; let failure: unknown;
	const pending = seekVideoFrameForCapture(video, .4, { timeoutMs: 0 }).then(
		() => { ready = true; }, error => { failure = error; },
	);
	video.completeSeek(); context.mock.timers.tick(10_000); await Promise.resolve();
	assert.equal(failure, undefined); assert.equal(ready, false);
	video.presentFrame(); await pending;
	assert.equal(ready, true); assertReleased(video);
});

test('a rejected native seek releases the pending presentation', async () => {
	const video = new NativeVideo();
	Object.defineProperty(video, 'currentTime', { set() { throw new RangeError('Seek rejected.'); } });
	await assert.rejects(seekVideoFrameForCapture(video, .4, { timeoutMs: 1_000 }), /Seek rejected/u);
	assertReleased(video);
});

test('older decoders without frame callbacks retain seek-event capture', async () => {
	const video = Object.assign(new EventTarget(), { currentTime: 0 });
	const pending = seekVideoFrameForCapture(video, .4, { timeoutMs: 1_000 });
	video.dispatchEvent(new Event('seeked')); await pending;
	assert.equal(video.currentTime, .4);
});
