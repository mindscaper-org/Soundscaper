/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { originalGroupFixtureCurrentV1 as fixture } from './helpers/lightscaper-desktop-original-group-fixture-current.ts';
import { remainsPending } from './helpers/async-test-control.ts';

const deadline = { timeout: 15_000 };
test('Lightscaper Original group does not deliver a prefix while its last alias read is held', deadline, async context => {
	const f = fixture(context), held = f.gate(); f.hooks.read = async photoId => { if (photoId === 'photo-1') await held.promise; };
	try {
		const work = f.acquireGroup([f.request(0), f.request(1)]);
		await f.reached('get-file', work); assert.equal(await remainsPending(work), true); assert.equal(f.counts().stages, 1); assert.equal(f.counts().groupCloses, 0);
		held.release(); const lease = await work; assert.equal(lease.bodies.length, 2); assert.equal(lease.bodies[0], lease.bodies[1]); await lease.close();
	} finally { held.release(); await f.close(); }
});

test('Lightscaper Original group owner close waits the published consumer lease without deleting shared Files', deadline, async context => {
	const f = fixture(context);
	try {
		const lease = await f.acquireGroup([f.request(0), f.request(1)]), closing = f.source.close();
		assert.equal(closing, f.source.close()); assert.equal(await remainsPending(closing), true); assert.equal(f.counts().stages, 1); assert.equal(f.counts().groupCloses, 0);
		let traps = 0; await assert.rejects(f.acquireGroup(new Proxy([], { ownKeys() { traps++; throw Error('Closed source reflected input.'); } }))); assert.equal(traps, 0);
		await lease.close(); await closing; assert.equal(f.counts().stages, 0); assert.equal(f.counts().groupCloses, 1);
	} finally { await f.close(); }
});

test('Lightscaper Original group cancellation eagerly requests native group close but joins the held real write and abort', deadline, async context => {
	const f = fixture(context), write = f.gate(), abort = f.gate(), released = f.gate(), caller = new AbortController(), reason = Symbol('cancel-group');
	f.hooks.write = async () => { await write.promise; }; f.hooks.abort = async () => { await abort.promise; }; f.hooks.release = async () => { await released.promise; };
	try {
		const work = f.acquireGroup([f.request(0), f.request(1)], caller.signal);
		await f.reached('write-start', work); caller.abort(reason); await f.reached('group-close-start', work);
		assert.equal(await remainsPending(work), true); assert.equal(f.counts().stages, 1);
		released.release(); assert.equal(await remainsPending(work), true); write.release(); await f.reached('writer-abort-start', work);
		assert.equal(await remainsPending(work), true); abort.release();
		await work.then(() => assert.fail('Cancelled group published.'), error => { assert.ok(Object.is(error, reason)); });
		assert.equal(f.counts().stages, 0); assert.equal(f.counts().groupCloses, 1);
	} finally { write.release(); abort.release(); released.release(); await f.close(); }
});

test('Lightscaper Original group waits a native open arriving after owner close and never starts OPFS', deadline, async context => {
	const f = fixture(context), held = f.gate(); f.hooks.groupOpen = async () => { await held.promise; };
	try {
		const work = f.acquireGroup([f.request(0), f.request(1)]); await f.reached('group-open-start', work);
		const closing = f.source.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.counts().stages, 0);
		held.release(); await assert.rejects(work); await closing; assert.equal(f.events.includes('root'), false); assert.equal(f.counts().groupCloses, 1);
	} finally { held.release(); await f.close(); }
});

test('Lightscaper Original group captures cleanup ID before refusing an extra-field or changed Original receipt', deadline, async context => {
	for (const mode of ['field', 'original'] as const) {
		const f = fixture(context);
		try {
			f.hooks.receipt = value => mode === 'field' ? { ...(value as object), path: '/native/private' }
				: { ...(value as object), originals: [{ ...f.request(0).original, name: 'changed' }] };
			await assert.rejects(f.acquireGroup([f.request(0)])); assert.equal(f.counts().groupCloses, 1); assert.equal(f.counts().stages, 0);
		} finally { await f.close(); }
	}
});

test('Lightscaper Original group pre-aborted opaque reason wins before native or OPFS work', deadline, async context => {
	const f = fixture(context), caller = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); caller.abort(opaque.proxy);
	try {
		await f.acquireGroup([f.request(0)], caller.signal).then(() => assert.fail('Pre-aborted group published.'), error => { assert.ok(Object.is(error, opaque.proxy)); });
		assert.deepEqual(f.events, []);
	} finally { await f.close(); }
});

test('Lightscaper Original group close reentry during request reflection sees a registered capture and cached owner join', deadline, async context => {
	const f = fixture(context); let closing: Promise<void> | undefined;
	try {
		const requests = new Proxy([f.request(0)], { ownKeys(target) { closing = f.source.close(); return Reflect.ownKeys(target); } });
		const work = f.acquireGroup(requests); assert.ok(closing); await assert.rejects(work); await closing;
		assert.equal(f.counts().groupOpens, 0); assert.equal(f.counts().stages, 0);
	} finally { await f.close(); }
});

test('Lightscaper Original group stage cleanup refusal fences siblings immediately and retains its reservation', deadline, async context => {
	const f = fixture(context), nativeClose = f.gate(), cleanup = Symbol('delete-refused');
	f.hooks.remove = async () => { throw cleanup; }; f.hooks.release = async () => { await nativeClose.promise; };
	try {
		const lease = await f.acquireGroup([f.request(0), f.request(1)]), retirement = lease.close();
		void retirement.catch(() => undefined); await f.reached('remove-start', retirement); assert.equal(await remainsPending(retirement), true);
		let traps = 0; await assert.rejects(f.acquire(new Proxy(f.request(2), { ownKeys() { traps++; throw new Error('Quarantine reflected input.'); } }))); assert.equal(traps, 0);
		nativeClose.release(); await retirement.then(() => assert.fail('Unproved stage cleanup acknowledged.'), error => { assert.ok(Object.is(error, cleanup)); });
		await assert.rejects(f.source.close()); assert.equal(f.counts().stages, 1); assert.equal(f.counts().groupCloses, 1);
	} finally { nativeClose.release(); await f.close().catch(() => undefined); }
});
