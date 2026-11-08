/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { acquirePhotoLibraryOriginalCurrentV1, capturePhotoLibraryOriginalSourceCurrentV1, withPhotoLibraryOriginalCurrentV1,
	type PhotoLibraryOriginalSourceCurrentV1 } from '../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const body = new Blob([Uint8Array.of(1, 2, 3)]);
function request() { const photo = queryPhotoV1(); return { catalogId: photo.catalogId, photoId: photo.id, original: { ...photo.original, byteLength: 3 } }; }
function outcome<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }

test('Original source captures method receiver and detached complete Original before acquisition yields', { timeout: 15_000 }, async () => {
	const entered = deferred<void>(), release = deferred<void>(), input = request(); let captured: Parameters<PhotoLibraryOriginalSourceCurrentV1['acquire']>[0] | undefined;
	const source: PhotoLibraryOriginalSourceCurrentV1 = { async acquire(value) {
		assert.equal(this, source); captured = value; entered.resolve(); await release.promise;
		return { body, async close() {} };
	} };
	const held = capturePhotoLibraryOriginalSourceCurrentV1(source);
	source.acquire = async () => { throw Error('replacement acquire'); };
	const work = acquirePhotoLibraryOriginalCurrentV1(held, input); await entered.promise;
	input.photoId = 'replacement'; input.original.name = 'replacement.jpg'; input.original.storageKey = 'replacement';
	release.resolve(); const lease = await work;
	assert.equal(captured?.photoId, queryPhotoV1().id); assert.equal(captured?.original.name, queryPhotoV1().original.name);
	assert.equal(captured?.original.storageKey, queryPhotoV1().original.storageKey); assert.ok(Object.isFrozen(captured?.original));
	assert.equal(lease.body.size, 3); await lease.close();
});

test('Original source joins actual consumer and cleanup before resolving or reusing the close promise', { timeout: 15_000 }, async () => {
	const consuming = deferred<void>(), releaseConsumer = deferred<void>(), closing = deferred<void>(), releaseClose = deferred<void>(); let closes = 0;
	const source = capturePhotoLibraryOriginalSourceCurrentV1({ async acquire() { return { body, async close() { closes++; closing.resolve(); await releaseClose.promise; } }; } });
	const work = withPhotoLibraryOriginalCurrentV1(source, request(), async value => {
		assert.ok(value instanceof Blob); consuming.resolve(); await releaseConsumer.promise; return 'complete';
	});
	try {
		await consuming.promise; assert.equal(closes, 0); assert.equal(await remainsPending(work), true);
		releaseConsumer.resolve(); await closing.promise; assert.equal(await remainsPending(work), true); releaseClose.resolve();
		assert.equal(await work, 'complete'); assert.equal(closes, 1);
		const lease = await acquirePhotoLibraryOriginalCurrentV1(source, request()), first = lease.close(), second = lease.close();
		assert.equal(first, second); await first; assert.equal(closes, 2);
	} finally { releaseConsumer.resolve(); releaseClose.resolve(); await Promise.allSettled([work]); }
});

test('Original source preserves opaque primary and cleanup errors independently without inspecting them', { timeout: 15_000 }, async () => {
	let traps = 0;
	const primary = new Proxy({}, { get() { traps++; throw Error('primary inspected'); }, getPrototypeOf() { traps++; throw Error('primary reflected'); } });
	const cleanup = new Proxy({}, { get() { traps++; throw Error('cleanup inspected'); }, getPrototypeOf() { traps++; throw Error('cleanup reflected'); } });
	const source = capturePhotoLibraryOriginalSourceCurrentV1({ async acquire() { return { body, async close() { throw cleanup; } }; } });
	const result = await outcome(withPhotoLibraryOriginalCurrentV1(source, request(), () => { throw primary; }));
	assert.equal(result.ok, false); if (result.ok) assert.fail('expected refusal');
	assert.ok(result.error instanceof AggregateError); assert.equal(result.error.errors.length, 2);
	assert.equal(result.error.errors[0], primary); assert.equal(result.error.errors[1], cleanup); assert.equal(traps, 0);
});

test('Original source closes invalid native body responses and retains validation plus cleanup failures', { timeout: 15_000 }, async () => {
	for (const value of [{ size: 3, slice() { throw Error('fake Blob invoked'); } }, new Blob([Uint8Array.of(1)])]) {
		let closes = 0;
		const source = capturePhotoLibraryOriginalSourceCurrentV1({ async acquire() { return { body: value as Blob, async close() { closes++; } }; } });
		await assert.rejects(acquirePhotoLibraryOriginalCurrentV1(source, request())); assert.equal(closes, 1);
	}
	const cleanup = Object.freeze({ cleanup: true });
	const source = capturePhotoLibraryOriginalSourceCurrentV1({ async acquire() { return { body: null as unknown as Blob, async close() { throw cleanup; } }; } });
	const result = await outcome(acquirePhotoLibraryOriginalCurrentV1(source, request())); assert.equal(result.ok, false);
	if (result.ok) assert.fail('expected refusal'); assert.ok(result.error instanceof AggregateError); assert.equal(result.error.errors[1], cleanup);
});

test('Original source cancellation waits acquisition and closes late File without callback publication or signal shadows', { timeout: 15_000 }, async () => {
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(); let closes = 0, delivered = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('reason inspected'); }, getPrototypeOf() { traps++; throw Error('reason reflected'); } });
	const source = capturePhotoLibraryOriginalSourceCurrentV1({ async acquire() { entered.resolve(); await release.promise;
		Object.defineProperty(stop.signal, 'throwIfAborted', { get() { traps++; throw Error('signal shadow'); } });
		return { body: new File([Uint8Array.of(1, 2, 3)], 'original.bin'), async close() { closes++; } };
	} });
	const work = withPhotoLibraryOriginalCurrentV1(source, request(), () => { delivered++; }, stop.signal), observed = outcome(work);
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve();
		const result = await observed; assert.equal(result.ok, false); if (result.ok) assert.fail('expected cancellation');
		assert.equal(result.error, reason); assert.equal(closes, 1); assert.equal(delivered, 0); assert.equal(traps, 0);
	} finally { release.resolve(); await Promise.allSettled([work]); }
});

test('Original source rejects accessor/extra/invalid request identity before source invocation', { timeout: 15_000 }, async () => {
	let calls = 0, getters = 0;
	const source = capturePhotoLibraryOriginalSourceCurrentV1({ async acquire() { calls++; return { body, async close() {} }; } });
	const accessor = Object.defineProperty(request(), 'photoId', { enumerable: true, get() { getters++; return 'injected'; } });
	for (const value of [accessor, { ...request(), path: '/outside' }, { ...request(), photoId: 'bad id' }, { ...request(), original: { ...request().original, retention: 'other' } }]) {
		await assert.rejects(acquirePhotoLibraryOriginalCurrentV1(source, value as ReturnType<typeof request>));
	}
	assert.equal(calls, 0); assert.equal(getters, 0);
});

test('Original source keeps genuine Web Core fallback while a present scoped source takes precedence', { timeout: 15_000 }, async () => {
	let fallbacks = 0, scoped = 0;
	const fallback = async (original: ReturnType<typeof request>['original']) => { fallbacks++; assert.equal(original.storageKey, request().original.storageKey); return body; };
	const web = capturePhotoLibraryOriginalSourceCurrentV1(undefined, fallback);
	assert.equal(await withPhotoLibraryOriginalCurrentV1(web, request(), value => value.size), 3);
	const native = capturePhotoLibraryOriginalSourceCurrentV1({ async acquire() { scoped++; return { body, async close() {} }; } }, fallback);
	assert.equal(await withPhotoLibraryOriginalCurrentV1(native, request(), value => value.size), 3);
	assert.equal(fallbacks, 1); assert.equal(scoped, 1);
});
