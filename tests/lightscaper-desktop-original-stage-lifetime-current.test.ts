/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { originalStageFixtureCurrentV1 as fixture } from './helpers/lightscaper-desktop-original-stage-fixture-current.ts';
import { deferred, remainsPending, waitForEvent } from './helpers/async-test-control.ts';

// The consumer contract closes a published lease only after its real work has
// joined. The stage owner cannot infer callback retirement from File creation.
test('Light Original owner close fences frontdoors and waits the live File consumer lease without deleting it', { timeout: 15_000 }, async () => {
	const f = fixture(), lease = await f.source.acquire(f.request), closing = f.source.close();
	assert.equal(f.source.close(), closing); assert.equal(await remainsPending(closing), true);
	assert.equal(f.stageCount(), 1); assert.equal(f.closedTickets.length, 0);
	let traps = 0; const value = new Proxy({}, { ownKeys() { traps++; throw new Error('Closed owner must not reflect inputs.'); } });
	await assert.rejects(f.source.acquire(value)); assert.equal(traps, 0);
	const first = lease.close(); assert.equal(lease.close(), first); await first; await closing;
	assert.equal(f.stageCount(), 0); assert.equal(f.closedTickets.length, 1);
});

test('Light Original pre-aborted opaque reason wins before transport and is never reflected', { timeout: 15_000 }, async () => {
	const f = fixture(), controller = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); controller.abort(opaque.proxy);
	let caught: unknown;
	try { await f.source.acquire(f.request, { signal: controller.signal }); } catch (error) { caught = error; }
	assert.equal(caught, opaque.proxy); assert.deepEqual(f.events, []); await f.source.close();
});

test('Light Original owner close joins an opening ticket arriving after cancellation and never starts OPFS', { timeout: 15_000 }, async () => {
	const gate = deferred<void>(), f = fixture(undefined, { openGate: gate }), pending = f.source.acquire(f.request);
	void pending.catch(() => undefined);
	try {
		await waitForEvent(f.events, 'open-start'); const closing = f.source.close();
		assert.equal(await remainsPending(closing), true); assert.equal(await remainsPending(pending), true); assert.equal(f.events.includes('root'), false);
		gate.resolve(); await assert.rejects(pending); await closing;
		assert.equal(f.closedTickets.length, 1); assert.equal(f.events.includes('root'), false);
	} finally { gate.resolve(); const lease = await pending.catch(() => null); await lease?.close(); await f.source.close(); }
});

test('Light Original owner cancellation requests ticket close while read is held and joins actual read before stage deletion', { timeout: 15_000 }, async () => {
	const read = deferred<void>(), release = deferred<void>(), f = fixture(undefined, { readGate: read, releaseGate: release });
	const controller = new AbortController(), reason = Symbol('cancel'), pending = f.source.acquire(f.request, { signal: controller.signal });
	void pending.catch(() => undefined);
	try {
		await waitForEvent(f.events, 'read-start'); controller.abort(reason);
		await waitForEvent(f.events, 'ticket-close-start'); assert.equal(await remainsPending(pending), true); assert.equal(f.stageCount(), 1);
		release.resolve(); assert.equal(await remainsPending(pending), true); assert.equal(f.stageCount(), 1);
		read.resolve(); let caught: unknown; try { await pending; } catch (error) { caught = error; } assert.equal(caught, reason);
		assert.equal(f.events.includes('write-start'), false); assert.equal(f.stageCount(), 0);
	} finally { read.resolve(); release.resolve(); await pending.catch(() => undefined); await f.source.close(); }
});

test('Light Original acquisition captures caller metadata synchronously before an async ticket open', { timeout: 15_000 }, async () => {
	const gate = deferred<void>(), f = fixture(undefined, { openGate: gate });
	const mutable = { ...f.request, original: { ...f.request.original } }, pending = f.source.acquire(mutable);
	mutable.photoId = 'other'; mutable.original.name = 'changed.png'; mutable.original.contentSha256 = '0'.repeat(64);
	try {
		await waitForEvent(f.events, 'open-start'); gate.resolve(); const lease = await pending;
		assert.equal(lease.body.size, f.request.original.byteLength); assert.equal(f.closedTickets.length, 0); await lease.close();
	} finally { gate.resolve(); const lease = await pending.catch(() => null); await lease?.close(); await f.source.close(); }
});

test('Light Original Proxy-triggered close sees the registered capture and joins before owner retirement', { timeout: 15_000 }, async () => {
	const f = fixture(); let closing: Promise<void> | undefined, entered = false;
	const proxy = new Proxy(f.request, { ownKeys(target) { entered = true; closing = f.source.close(); return Reflect.ownKeys(target); } });
	const pending = f.source.acquire(proxy); void pending.catch(() => undefined);
	assert.equal(entered, true); assert.ok(closing); await assert.rejects(pending); await closing;
	assert.equal(f.events.includes('open-start'), false); assert.equal(f.stageCount(), 0);
});

test('Light Original writable close failure joins abort and preserves an opaque primary without publishing File', { timeout: 15_000 }, async () => {
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const f = fixture(undefined, { closeFailure: opaque.proxy });
	let caught: unknown; try { await f.source.acquire(f.request); } catch (error) { caught = error; }
	assert.equal(caught, opaque.proxy); assert.ok(f.events.includes('writer-abort-end'));
	assert.equal(f.events.includes('get-file'), false); assert.equal(f.stageCount(), 0); await f.source.close();
});

test('Light Original published lease removal failure remains cached and prevents a false parent retirement receipt', { timeout: 15_000 }, async () => {
	const cleanup = new Error('Owned stage deletion refused'), f = fixture(undefined, { removeFailure: cleanup }), lease = await f.source.acquire(f.request);
	const closing = lease.close(); assert.equal(lease.close(), closing); await assert.rejects(closing, error => error === cleanup);
	assert.equal(f.closedTickets.length, 1); assert.equal(f.stageCount(), 1); await assert.rejects(f.source.close());
});
