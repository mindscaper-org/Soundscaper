/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TracktionWebAudio } from '../src/soundscaper/tracktion-web-audio.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

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
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
	Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: BrowserAudioContext });
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, 'AudioContext', previous);
		else Reflect.deleteProperty(globalThis, 'AudioContext');
	});
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
