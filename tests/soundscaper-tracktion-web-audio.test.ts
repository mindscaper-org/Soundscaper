/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { TracktionWebAudio } from '../src/soundscaper/tracktion-web-audio.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function replaceBrowserGlobal(context: TestContext, key: string, value: unknown): void {
	const previous = Object.getOwnPropertyDescriptor(globalThis, key);
	Object.defineProperty(globalThis, key, { configurable: true, value });
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, key, previous);
		else Reflect.deleteProperty(globalThis, key);
	});
}

test('a stalled browser audio startup expires for all callers and can retry', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const firstModule = deferred<void>();
	const firstClose = deferred<void>();
	const closed: number[] = [];
	const modules: string[] = [];
	let created = 0;
	class BrowserAudioContext {
		readonly number = ++created;
		readonly sampleRate = 48_000;
		readonly audioWorklet = { addModule: (url: string) => {
			modules.push(url);
			return this.number === 1 ? firstModule.promise : Promise.resolve();
		} };
		resume(): Promise<void> { return Promise.resolve(); }
		close(): Promise<void> {
			closed.push(this.number);
			return this.number === 1 ? firstClose.promise : Promise.resolve();
		}
	}
	replaceBrowserGlobal(context, 'AudioContext', BrowserAudioContext);
	const audio = new TracktionWebAudio();
	const initializing = Promise.all([
		assert.rejects(audio.prepare(48_000), /audio.*timed out/iu),
		assert.rejects(audio.prepare(48_000), /audio.*timed out/iu),
	]);
	context.mock.timers.tick(9_999);
	assert.equal(await remainsPending(initializing), true);
	context.mock.timers.tick(1);
	assert.equal(await remainsPending(initializing), false);
	await initializing;
	assert.deepEqual(closed, [1]);

	await audio.prepare(48_000);
	assert.equal(created, 2);
	assert.equal(modules[0], '/tracktion/tracktion-audio-worklet.js');
	assert.match(modules[1], /^\/tracktion\/tracktion-audio-worklet\.js\?retry=[a-f0-9-]{36}$/u);
	assert.ok(audio.outputBuffer().byteLength > 0);
	firstModule.reject(new Error('The old module request eventually failed'));
	firstClose.reject(new Error('The old output context was already retired'));
	await audio.close();
	assert.deepEqual(closed, [1, 2]);
});

for (const initiallyLive of [true, false]) test(`recording releases browser startup when the microphone is lost (initially live: ${initiallyLive})`, async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const firstModule = deferred<void>();
	const granted = deferred<void>();
	const modules: string[] = [];
	let closed = 0;
	let microphoneStopped = 0;
	const track = Object.assign(new EventTarget(), {
		readyState: initiallyLive ? 'live' : 'ended',
		stop() { this.readyState = 'ended'; microphoneStopped += 1; },
	});
	const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
	class BrowserAudioContext {
		readonly sampleRate = 48_000;
		readonly audioWorklet = { addModule: (url: string) => {
			modules.push(url);
			return modules.length === 1 ? firstModule.promise : Promise.resolve();
		} };
		resume(): Promise<void> { return Promise.resolve(); }
		close(): Promise<void> { closed += 1; return Promise.resolve(); }
	}
	replaceBrowserGlobal(context, 'AudioContext', BrowserAudioContext);
	replaceBrowserGlobal(context, 'navigator', { mediaDevices: { getUserMedia: async () => { granted.resolve(); return stream; } } });

	const audio = new TracktionWebAudio();
	const initializing = assert.rejects(audio.microphoneBuffers(48_000), /microphone disconnected/u);
	await granted.promise;
	if (initiallyLive) {
		assert.equal(await remainsPending(initializing), true);
		track.readyState = 'ended';
		track.dispatchEvent(new Event('ended'));
	}
	assert.equal(await remainsPending(initializing), false);
	await initializing;
	assert.equal(microphoneStopped, 1);
	assert.equal(closed, 1);

	await audio.prepare(48_000);
	assert.match(modules[1], /^\/tracktion\/tracktion-audio-worklet\.js\?retry=[a-f0-9-]{36}$/u);
	firstModule.reject(new Error('The retired browser worklet eventually failed'));
	assert.ok(audio.outputBuffer().byteLength > 0);
	await audio.close();
	assert.equal(closed, 2);
});

test('recording reports a denied microphone while its new output context is still starting', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const firstModule = deferred<void>();
	const modules: string[] = [];
	const denied = new DOMException('Permission denied', 'NotAllowedError');
	let closed = 0;
	class BrowserAudioContext {
		readonly sampleRate = 48_000;
		readonly audioWorklet = { addModule: (url: string) => {
			modules.push(url);
			return modules.length === 1 ? firstModule.promise : Promise.resolve();
		} };
		resume(): Promise<void> { return Promise.resolve(); }
		close(): Promise<void> { closed += 1; return Promise.resolve(); }
	}
	replaceBrowserGlobal(context, 'AudioContext', BrowserAudioContext);
	replaceBrowserGlobal(context, 'navigator', { mediaDevices: { getUserMedia: () => Promise.reject(denied) } });

	const audio = new TracktionWebAudio();
	const initializing = assert.rejects(audio.microphoneBuffers(48_000), (error) => error === denied);
	assert.equal(await remainsPending(initializing), false);
	await initializing;
	assert.equal(closed, 1);

	await audio.prepare(48_000);
	assert.match(modules[1], /^\/tracktion\/tracktion-audio-worklet\.js\?retry=[a-f0-9-]{36}$/u);
	firstModule.reject(new Error('The denied recording’s old worklet eventually failed'));
	assert.ok(audio.outputBuffer().byteLength > 0);
	await audio.close();
	assert.equal(closed, 2);
});

test('recording reports failed output while permission is pending and stops a later unused microphone', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const firstModule = deferred<void>();
	const outputFailure = new DOMException('The audio worklet could not be loaded', 'AbortError');
	const lateStopped = deferred<void>();
	const lateTrack = { stop: () => { lateStopped.resolve(); } };
	const firstInput = deferred<{ getTracks(): readonly (typeof lateTrack)[] }>();
	let retryStops = 0;
	const retryTrack = Object.assign(new EventTarget(), { readyState: 'live', stop: () => { retryStops += 1; } });
	const retryInput = { getAudioTracks: () => [retryTrack], getTracks: () => [retryTrack] };
	let inputs = 0;
	let contexts = 0;
	let closed = 0;
	class BrowserAudioContext {
		readonly number = ++contexts;
		readonly sampleRate = 48_000;
		readonly audioWorklet = { addModule: () => this.number === 1 ? firstModule.promise : Promise.resolve() };
		resume(): Promise<void> { return Promise.resolve(); }
		createMediaStreamSource() { return { disconnect() {} }; }
		close(): Promise<void> { closed += 1; return Promise.resolve(); }
	}
	replaceBrowserGlobal(context, 'AudioContext', BrowserAudioContext);
	replaceBrowserGlobal(context, 'navigator', { mediaDevices: {
		getUserMedia: () => ++inputs === 1 ? firstInput.promise : Promise.resolve(retryInput),
	} });

	const audio = new TracktionWebAudio();
	const starting = assert.rejects(audio.microphoneBuffers(48_000), (error) => error === outputFailure);
	firstModule.reject(outputFailure);
	assert.equal(await remainsPending(starting), false);
	await starting;
	assert.equal(closed, 1);
	assert.ok((await audio.microphoneBuffers(48_000)).capture);
	firstInput.resolve({ getTracks: () => [lateTrack] });
	assert.equal(await remainsPending(lateStopped.promise), false);
	assert.equal(retryStops, 0);
	await audio.close();
	assert.equal(retryStops, 1);
	assert.equal(closed, 2);
});
