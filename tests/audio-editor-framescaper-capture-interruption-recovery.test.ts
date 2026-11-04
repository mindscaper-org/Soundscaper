/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBrowserAudioRecorder } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-audio-recorder.ts';
import { installCaptureSourceEndWatchers, captureSessionFailure } from '../src/common/editor/controller/capture/internal/framescaper-capture-session-runtime.ts';
import { MediaInputLostError, observeMediaInputInterruption } from '../src/common/editor/controller/shared/media-input-interruption.ts';

test('Framescaper audio resumes an interrupted worklet context and reports a closed device context', async () => {
	const events = new EventTarget();
	const context = {
		sampleRate: 48_000, state: 'running',
		async resume() { context.state = 'running'; },
		addEventListener: (type: string, listener: () => void) => events.addEventListener(type, listener),
		removeEventListener: (type: string, listener: () => void) => events.removeEventListener(type, listener),
	};
	const failures: unknown[] = [];
	let stopped = 0;
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone', track: { getSettings: () => ({ sampleRate: 48_000, channelCount: 1 }) },
		stream: {}, context, MediaStreamTrackProcessor: null, observeInput: observeMediaInputInterruption,
		recordingControllerFactory: () => ({
			start() {}, pause: () => true, resume: () => true,
			stop() { stopped += 1; }, detach() {},
		}),
		onChunk() {}, onError: error => { failures.push(error); },
	});
	recorder.start();
	context.state = 'interrupted'; events.dispatchEvent(new Event('statechange'));
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(context.state, 'running');
	assert.equal(recorder.state, 'recording');
	assert.deepEqual(failures, []);
	context.state = 'closed'; events.dispatchEvent(new Event('statechange'));
	assert.equal(recorder.state, 'failed');
	assert.equal(captureSessionFailure(failures[0], 'encoder-failed').code, 'device-lost');
	await assert.rejects(recorder.stop(), MediaInputLostError);
	await assert.rejects(recorder.dispose(), MediaInputLostError);
	assert.equal(stopped, 1);
});

test('Framescaper source mute recovers on the same track, while sustained loss requests durable recovery once', context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const events = new EventTarget();
	const track = {
		readyState: 'live', muted: false,
		addEventListener: (type: string, listener: () => void) => events.addEventListener(type, listener),
		removeEventListener: (type: string, listener: () => void) => events.removeEventListener(type, listener),
	};
	const failures: Error[] = [];
	const cleanup = installCaptureSourceEndWatchers([{
		sourceId: 'camera', role: 'camera', stream: {}, track, settings: {}, capabilities: {},
	}], error => { failures.push(error); }, observeMediaInputInterruption);
	track.muted = true; events.dispatchEvent(new Event('mute'));
	context.mock.timers.tick(4_000);
	track.muted = false; events.dispatchEvent(new Event('unmute'));
	context.mock.timers.tick(5_000);
	assert.equal(failures.length, 0);
	track.muted = true; events.dispatchEvent(new Event('mute'));
	context.mock.timers.tick(5_000);
	track.readyState = 'ended'; events.dispatchEvent(new Event('ended'));
	assert.equal(failures.length, 1);
	assert.ok(failures[0] instanceof MediaInputLostError);
	assert.equal(captureSessionFailure(failures[0], 'encoder-failed').code, 'device-lost');
	for (const remove of cleanup) remove();
});

test('direct capture watchers contain synchronous and asynchronous end observers without injection', async () => {
	for (const rejectAsynchronously of [false, true]) {
		let ended: (() => void) | undefined;
		const cleanup = installCaptureSourceEndWatchers([{
			sourceId: 'camera', role: 'camera', stream: {}, settings: {}, capabilities: {},
			track: { addEventListener(_type: string, listener: () => void) { ended = listener; } },
		}], () => {
			if (rejectAsynchronously) return Promise.reject(new Error('async observer failed'));
			throw new Error('observer failed');
		});
		assert.doesNotThrow(() => ended?.());
		await new Promise<void>(resolve => setImmediate(resolve));
		for (const remove of cleanup) remove();
	}
});
