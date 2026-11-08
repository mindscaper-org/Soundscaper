/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoSmartCollectionArchiveCaptureV1 } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import type { PhotoSmartCollectionWriteOptionsV1, PhotoSmartCollectionWriteReceiptV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { PhotoCatalogClosedError } from '../src/lightscaper/catalog/repository-types.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const CATALOG = 'catalog-1';
const root = () => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
	id: CATALOG, name: 'Native saved lifetime', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
const definition = (index = 0) => ({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: CATALOG,
	id: `saved-${String(index).padStart(4, '0')}`, revision: 0, name: 'Captured name', query: { ...normalizePhotoCatalogQueryV2(), text: 'captured' } });
const options = (revision = 0): PhotoSmartCollectionWriteOptionsV1 => ({ expectedCatalogRevision: revision,
	expectedIndexRevision: revision, expectedStateRevision: revision });
function invoke<T>(store: Store, name: string, args: unknown[]): Promise<T> {
	const method: unknown = Reflect.get(store, name); assert.equal(typeof method, 'function', `Genuine saved owner must implement ${name}.`);
	return Reflect.apply(method as (...values: unknown[]) => Promise<T>, store, args);
}
const save = (store: Store, value: unknown, opts: PhotoSmartCollectionWriteOptionsV1 = options()) =>
	invoke<PhotoSmartCollectionWriteReceiptV1>(store, 'saveSmartCollection', [value, null, opts]);
async function seed(store: Store, count = 12): Promise<void> {
	for (let index = 0; index < count; index++) await save(store, definition(index), options(index));
}
async function fixture(run: (store: Store, directory: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper saved lifecycle ü '))), store = await Store.open({ appDataPath: directory });
	try { await store.createCatalog(root()); await run(store, directory); } finally { await store.close(); }
	// Failed diagnostic fixtures stay owned by Root until every gate has joined.
	await rm(directory, { recursive: true, force: false });
}

test('Lightscaper saved owner captures complete definition/options before held actual Original work', async () => {
	await fixture(async store => {
		assert.equal(typeof Reflect.get(store, 'saveSmartCollection'), 'function');
		const entered = deferred<void>(), release = deferred<void>(); let upload: Promise<unknown> | undefined, writing: Promise<PhotoSmartCollectionWriteReceiptV1> | undefined;
		try {
			upload = store.storeOriginal(photoArchiveFixture(1).photo.original, (async function* () { entered.resolve(); await release.promise; yield Uint8Array.of(1, 2, 3); })());
			await entered.promise; const borrowed = definition(), expected = options(), before = structuredClone(borrowed);
			writing = save(store, borrowed, expected); borrowed.name = 'Changed after admission'; borrowed.query.text = 'changed';
			Object.assign(expected, { expectedCatalogRevision: 999 }); assert.equal(await remainsPending(writing), true);
			release.resolve(); await upload; assert.deepEqual((await writing).definition, before);
			assert.deepEqual(await invoke(store, 'loadSmartCollection', [CATALOG, before.id]), before);
		} finally { release.resolve(); await Promise.allSettled([upload, writing]); }
	});
});

test('Lightscaper saved owner preserves an opaque queued cancellation and refuses candidate getters without invoking them', async () => {
	await fixture(async store => {
		assert.equal(typeof Reflect.get(store, 'saveSmartCollection'), 'function'); const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		let upload: Promise<unknown> | undefined, writing: Promise<unknown> | undefined, hostile: Promise<unknown> | undefined, traps = 0, getters = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque reason read.'); }, getPrototypeOf() { traps++; throw Error('Opaque reason prototype.'); } });
		try {
			upload = store.storeOriginal(photoArchiveFixture(1).photo.original, (async function* () { entered.resolve(); await release.promise; yield Uint8Array.of(1, 2, 3); })()); await entered.promise;
			hostile = save(store, { ...definition(), get query() { getters++; return {}; } }); const refused = assert.rejects(hostile);
			writing = save(store, definition(), { ...options(), signal: stop.signal });
			const cancelled = writing.then(() => assert.fail('Cancelled saved write must refuse.'), (error: unknown) => { assert.equal(error, reason); });
			stop.abort(reason); release.resolve(); await upload; await refused; await cancelled; assert.equal(traps, 0); assert.equal(getters, 0);
			assert.deepEqual(await invoke(store, 'readSmartCollectionPage', [CATALOG]), { items: [], continuation: null });
		} finally { release.resolve(); await Promise.allSettled([upload, writing, hostile]); }
	});
});

test('Lightscaper saved owner caches its close fence before Proxy admission can reenter shutdown', async () => {
	await fixture(async store => {
		assert.equal(typeof Reflect.get(store, 'saveSmartCollection'), 'function'); let closing: Promise<void> | undefined, entered = false;
		const borrowed = new Proxy(definition(), { ownKeys(target) { if (!entered) { entered = true; closing = store.close(); } return Reflect.ownKeys(target); } });
		const writing = save(store, borrowed); assert.equal(entered, true); assert.ok(closing);
		await assert.rejects(writing, { code: 'CATALOG_CLOSED' }); await closing;
		assert.equal(store.close(), closing); await assert.rejects(save(store, definition()), { code: 'CATALOG_CLOSED' });
	});
});

test('Lightscaper saved owner aborts and joins actual multi-page audit snapshots before closing SQLite', async () => {
	await fixture(async (store, directory) => {
		await seed(store); const nativeExec = DatabaseSync.prototype.exec; let reads = 0, writes = 0, closing: Promise<void> | undefined;
		DatabaseSync.prototype.exec = function (sql: string): void {
			nativeExec.call(this, sql); if (sql === 'BEGIN IMMEDIATE') writes++;
			if (sql === 'COMMIT' && ++reads === 3) closing = store.close();
		};
		try {
			await assert.rejects(save(store, definition(99), options(12)), { code: 'CATALOG_CLOSED' }); assert.ok(closing); await closing;
			assert.equal(writes, 0, 'Shutdown must cancel the bounded read audit before its mutation transaction.');
		} finally { DatabaseSync.prototype.exec = nativeExec; await closing; }
		const reopened = await Store.open({ appDataPath: directory });
		try { assert.equal((await invoke<{ collectionCount: number }>(reopened, 'readSmartCollectionState', [CATALOG])).collectionCount, 12); }
		finally { await reopened.close(); }
	});
});

test('Lightscaper saved owner keeps a durable write acknowledgement when close reenters after the real SQLite COMMIT', async () => {
	await fixture(async (store, directory) => {
		assert.equal(typeof Reflect.get(store, 'saveSmartCollection'), 'function'); const nativeExec = DatabaseSync.prototype.exec;
		const writers = new WeakSet<DatabaseSync>(); let closing: Promise<void> | undefined, receipt: PhotoSmartCollectionWriteReceiptV1 | undefined;
		DatabaseSync.prototype.exec = function (sql: string): void {
			const committed = sql === 'COMMIT' && writers.has(this); nativeExec.call(this, sql);
			if (sql === 'BEGIN IMMEDIATE') writers.add(this);
			if (committed) { writers.delete(this); closing = store.close(); }
		};
		try { receipt = await save(store, definition()); assert.ok(closing); await closing; assert.equal(receipt.state.collectionCount, 1); }
		finally { DatabaseSync.prototype.exec = nativeExec; await closing; }
		const reopened = await Store.open({ appDataPath: directory });
		try { assert.deepEqual(await invoke(reopened, 'loadSmartCollection', [CATALOG, definition().id]), receipt?.definition); }
		finally { await reopened.close(); }
	});
});

test('Lightscaper saved owner retires an escaped archive iterator and joins its active final audit before DB close', async () => {
	await fixture(async (store, directory) => {
		await seed(store); const capture = await invoke<PhotoSmartCollectionArchiveCaptureV1>(store, 'captureSmartCollectionArchiveV1', [CATALOG]);
		const iterator = capture.definitions[Symbol.asyncIterator](); let count = 0;
		while (!(await iterator.next()).done) count++; assert.equal(count, 12);
		const verifying = capture.verify(), refused = assert.rejects(verifying), closing = store.close();
		await refused; await closing;
		try { assert.equal((await iterator.next()).done, true); } catch (error) { assert.ok(error instanceof PhotoCatalogClosedError); }
		await assert.rejects(capture.verify()); await iterator.return?.();
		const reopened = await Store.open({ appDataPath: directory });
		try { assert.equal((await invoke<{ collectionCount: number }>(reopened, 'readSmartCollectionState', [CATALOG])).collectionCount, 12); }
		finally { await reopened.close(); }
	});
});

test('Lightscaper saved owner releases caller abort listeners after a successful archive verification', async () => {
	await fixture(async store => {
		await seed(store, 1); const stop = new AbortController();
		const capture = await invoke<PhotoSmartCollectionArchiveCaptureV1>(store, 'captureSmartCollectionArchiveV1', [CATALOG, { signal: stop.signal }]);
		assert.equal(getEventListeners(stop.signal, 'abort').length, 1);
		const iterator = capture.definitions[Symbol.asyncIterator]();
		while (!(await iterator.next()).done) { /* Consume the genuine native source before its final audit. */ }
		assert.equal(getEventListeners(stop.signal, 'abort').length, 1, 'Natural exhaustion retains authority for verification.');
		await capture.verify(); assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
	});
});

test('Lightscaper saved owner releases caller abort listeners after an explicit archive iterator return', async () => {
	await fixture(async store => {
		await seed(store, 1); const stop = new AbortController();
		const capture = await invoke<PhotoSmartCollectionArchiveCaptureV1>(store, 'captureSmartCollectionArchiveV1', [CATALOG, { signal: stop.signal }]);
		assert.equal(getEventListeners(stop.signal, 'abort').length, 1);
		const iterator = capture.definitions[Symbol.asyncIterator](); assert.equal((await iterator.next()).done, false);
		await iterator.return?.(); assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
		await assert.rejects(capture.verify());
	});
});
