/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	observeMediaInputInterruption,
	MediaInputLostError,
} from '../src/common/editor/controller/shared/media-input-interruption.ts';

function fixture() {
	const listeners = new Map<string, Set<() => void>>();
	const events: string[] = [];
	const failures: unknown[] = [];
	const timers = new Map<number, () => void>();
	let nextTimer = 0;
	const track = {
		readyState: 'live', muted: false,
		addEventListener(type: string, listener: () => void) {
			const values = listeners.get(type) ?? new Set(); values.add(listener); listeners.set(type, values);
		},
		removeEventListener(type: string, listener: () => void) { listeners.get(type)?.delete(listener); },
	};
	const context = {
		state: 'running',
		async resume() { context.state = 'running'; },
		addEventListener: track.addEventListener,
		removeEventListener: track.removeEventListener,
	};
	return {
		track, context, events, failures, timers,
		emit(type: string) { for (const listener of [...listeners.get(type) ?? []]) listener(); },
		listenerCount: () => [...listeners.values()].reduce((sum, values) => sum + values.size, 0),
		options: {
			tracks: [track], context,
			onInterrupted: (error: Error) => { failures.push(error); },
			log: (message: string) => { events.push(message); },
			setTimeout: (callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id; },
			clearTimeout: (id: unknown) => { timers.delete(Number(id)); },
		},
	};
}

test('a muted live recording input recovers on its existing track and removes its deadline', () => {
	const current = fixture();
	const cleanup = observeMediaInputInterruption(current.options);
	current.track.muted = true; current.emit('mute');
	assert.equal(current.timers.size, 1);
	current.track.muted = false; current.emit('unmute');
	assert.equal(current.timers.size, 0);
	assert.deepEqual(current.failures, []);
	assert.match(current.events.join(' '), /temporarily unavailable.*recovered/u);
	cleanup(); cleanup();
	assert.equal(current.listenerCount(), 0);
});

test('an input that stays muted stops once and preserves its explicit loss reason', () => {
	const current = fixture();
	const cleanup = observeMediaInputInterruption(current.options);
	current.track.muted = true; current.emit('mute'); current.emit('mute');
	assert.equal(current.timers.size, 1);
	[...current.timers.values()][0]!();
	current.track.readyState = 'ended'; current.emit('ended');
	assert.equal(current.failures.length, 1);
	assert.ok(current.failures[0] instanceof MediaInputLostError);
	cleanup();
});

test('a suspended recording context resumes automatically without stopping capture', async () => {
	const current = fixture();
	const cleanup = observeMediaInputInterruption(current.options);
	current.context.state = 'interrupted'; current.emit('statechange'); current.emit('statechange');
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(current.context.state, 'running');
	assert.deepEqual(current.failures, []);
	assert.equal(current.timers.size, 0);
	assert.match(current.events.join(' '), /recovered/u);
	cleanup();
});

test('a closed context and throwing failure observers cannot escape a browser event', () => {
	const current = fixture();
	const cleanup = observeMediaInputInterruption({ ...current.options,
		onInterrupted() { throw new Error('observer failed'); },
		log() { throw new Error('logger failed'); },
	});
	current.context.state = 'closed';
	assert.doesNotThrow(() => current.emit('statechange'));
	cleanup();
});

test('a hung resume is bounded and its late result cannot interrupt a disposed recording', async () => {
	const current = fixture();
	let resolveResume!: () => void;
	current.context.resume = () => new Promise<void>(resolve => { resolveResume = resolve; });
	const cleanup = observeMediaInputInterruption(current.options);
	current.context.state = 'suspended'; current.emit('statechange');
	await Promise.resolve();
	assert.equal(current.timers.size, 1);
	[...current.timers.values()][0]!();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(current.failures.length, 1);
	cleanup(); resolveResume();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(current.failures.length, 1);
	assert.equal(current.listenerCount(), 0);
});

test('an already ended input is detected when lifecycle ownership is installed', () => {
	const current = fixture(); current.track.readyState = 'ended';
	const cleanup = observeMediaInputInterruption(current.options);
	assert.equal(current.failures.length, 1);
	cleanup();
});

test('disposal fences pending context recovery before it can resume a replacement source', async () => {
	const current = fixture();
	let resumes = 0;
	current.context.resume = async () => { resumes += 1; };
	const cleanup = observeMediaInputInterruption(current.options);
	current.context.state = 'suspended'; current.emit('statechange'); cleanup();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(resumes, 0);
	assert.deepEqual(current.failures, []);
	assert.equal(current.timers.size, 0);
});

test('a rejecting asynchronous interruption observer is contained and logged', async () => {
	const current = fixture();
	const cleanup = observeMediaInputInterruption({ ...current.options,
		onInterrupted: async () => { throw new Error('save failed'); },
	});
	current.track.readyState = 'ended'; current.emit('ended');
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.match(current.events.join(' '), /cleanup failed/u);
	cleanup();
});

test('an external running state recovers before a pending resume promise settles', async () => {
	const current = fixture();
	let rejectResume!: (reason: unknown) => void;
	current.context.resume = () => new Promise<void>((_resolve, reject) => { rejectResume = reject; });
	const cleanup = observeMediaInputInterruption(current.options);
	current.context.state = 'interrupted'; current.emit('statechange');
	await Promise.resolve();
	current.context.state = 'running'; current.emit('statechange');
	assert.equal(current.timers.size, 0);
	rejectResume(new Error('stale resume rejection'));
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(current.failures, []);
	assert.equal(current.events.filter(message => message.includes('recovered')).length, 1);
	cleanup();
});
