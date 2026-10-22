/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { LightscaperNativePhotoMediaLifetimeCurrentV1 as Lifetime } from '../desktop/lightscaper-native-photo-media-lifetime-current-v1.ts';

test('Lightscaper native media lifetime joins an accepted asynchronous capture after shutdown before retiring', async () => {
	const lifetime = new Lifetime(); let release!: (value: number) => void, retired = false, ran = false;
	const held = new Promise<number>(resolve => { release = resolve; });
	const work = lifetime.run({}, () => held, async value => { ran = true; return value; });
	void work.catch(() => undefined);
	const closing = lifetime.close(() => { retired = true; });
	assert.equal(lifetime.close(() => { throw new Error('Duplicate retirement'); }), closing);
	await yieldTurn(); assert.equal(retired, false);
	release(1); await assert.rejects(work); await closing;
	assert.equal(ran, false); assert.equal(retired, true);
});

test('Lightscaper native media lifetime registers before capture and preserves an actual operation ACK through close reentry', async () => {
	const lifetime = new Lifetime(); let closing: Promise<void> | undefined, retired = false;
	const work = lifetime.run({}, () => 42, async value => {
		closing = lifetime.close(() => { retired = true; });
		assert.equal(retired, false); return value;
	});
	assert.equal(await work, 42); assert.ok(closing); await closing; assert.equal(retired, true);
	let reads = 0;
	await assert.rejects(lifetime.run(new Proxy({}, { ownKeys() { reads++; return []; } }), () => 0, async value => value));
	assert.equal(reads, 0);
});

test('Lightscaper native media lifetime links captured native signals without inspecting late own shadows or opaque reasons', async () => {
	const lifetime = new Lifetime(), caller = new AbortController();
	const reason = new Proxy({}, { get() { throw new Error('Opaque reason inspected'); }, getPrototypeOf() { throw new Error('Opaque prototype inspected'); } });
	let release!: () => void, privateSignal: AbortSignal | undefined, trapped = 0;
	const held = new Promise<void>(resolve => { release = resolve; });
	const work = lifetime.run({ signal: caller.signal }, () => {
		Object.defineProperties(caller.signal, {
			aborted: { get() { trapped++; throw new Error('Borrowed aborted'); } }, reason: { get() { trapped++; throw new Error('Borrowed reason'); } },
			addEventListener: { value: () => { trapped++; throw new Error('Borrowed listener'); } },
		});
		return 1;
	}, async (_value, signal) => { privateSignal = signal; await held; Reflect.apply(AbortSignal.prototype.throwIfAborted, signal, []); });
	await yieldTurn(); assert.ok(privateSignal); caller.abort(reason); release();
	let failed = false;
	await work.then(() => { assert.fail('Expected caller cancellation'); }, (failure: unknown) => { failed = true; assert.equal(failure, reason); });
	assert.equal(failed, true); assert.equal(trapped, 0); await lifetime.close(() => undefined);
});
