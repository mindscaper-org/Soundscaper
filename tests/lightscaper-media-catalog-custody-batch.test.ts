/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { CATALOG_ORIGINAL_ROOT_STORE_NAME as ROOTS, type CatalogOriginalReferenceV1 } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import { PHOTO_LARGE_LIBRARY_PNG_BASE64_V1, PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 as SPEC } from '../src/lightscaper/quality/large-library-workload-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const OPTIONS = { timeout: 15_000 };
async function fixture() {
	const indexedDB = createInstrumentedIndexedDB(), name = `custody-batch-${crypto.randomUUID()}`;
	const store = createProjectStore({ indexedDB, databaseName: name, memoryFallback: false, preferOpfs: false });
	try {
		const references: CatalogOriginalReferenceV1[] = [];
		for (const assetId of ['asset-a', 'asset-b']) {
			const body = assetId === 'asset-a' ? Buffer.from(PHOTO_LARGE_LIBRARY_PNG_BASE64_V1, 'base64') : new TextEncoder().encode('another immutable Original');
			const metadata = await store.writeMediaAsset(assetId, new Blob([body]));
			references.push({ photoId: `initial-${assetId}`, assetId, sourceId: `logical-${assetId}`,
				sha256: String(metadata.sha256), size: Number(metadata.size) });
		}
		const database = await openDatabase(indexedDB as unknown as IDBFactory, name);
		const assets = () => indexedDB.records(name, 'mediaAssets') as StorageRecord[];
		return { indexedDB, name, store, database, a: references[0]!, b: references[1]!, assets,
			custody: store.mediaRepository.catalogOriginals,
			rows: () => ({ assets: assets(), roots: indexedDB.records(name, ROOTS) as unknown[] }),
			asset: (id: string) => { const value = assets().find(row => row.sourceId === id); assert.ok(value); return value; },
			close: async () => { database.close(); await store.close(); } };
	} catch (error) { await store.close(); throw error; }
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function ref(source: CatalogOriginalReferenceV1, photoId: string, sourceId = `logical-${photoId}`): CatalogOriginalReferenceV1 {
	return { ...source, photoId, sourceId };
}
function immutable(record: StorageRecord): StorageRecord {
	const result = { ...record }; delete result.catalogRootCount; return result;
}

async function rejectsWithExactReason(work: Promise<unknown>, reason: unknown): Promise<void> {
	// assert.rejects returns the caught reason through an async helper, which
	// probes its `then` property. An opaque revoked reason must never be probed.
	await work.then(() => { assert.fail('Expected the custody operation to reject.'); }, (observed: unknown) => {
		assert.ok(Object.is(observed, reason), 'The exact supplied rejection reason must survive.');
	});
}

test('mixed existing and new roots retain two physical assets across catalogs without conflating logical source IDs', OPTIONS, async () => {
	const f = await fixture();
	try {
		const before = f.assets().map(immutable), existing = ref(f.a, 'existing', 'old-logical-source');
		await f.custody.retain('catalog', [existing]);
		await f.custody.retain('other-catalog', [ref(f.a, 'foreign-a'), ref(f.b, 'foreign-b')]);
		const batch = [existing, ref(f.b, 'new-b'), ref(f.a, 'new-a-1'), ref(f.a, 'new-a-2')];
		await f.custody.retain('catalog', batch);
		assert.equal(f.asset(f.a.assetId).catalogRootCount, 4); assert.equal(f.asset(f.b.assetId).catalogRootCount, 2);
		const page = await f.custody.readPage({ catalogId: 'catalog' });
		assert.equal(page.roots.length, 4);
		for (const input of batch) {
			const root = page.roots.find(row => row.photoId === input.photoId); assert.ok(root);
			for (const key of ['assetId', 'sourceId', 'sha256', 'size'] as const) assert.equal(root[key], input[key]);
			assert.equal(root.mediaContentToken, f.asset(input.assetId).mediaContentToken);
			assert.notEqual(input.sourceId, input.assetId, 'logical source identity is independent of the physical media key');
		}
		const committed = f.rows(); await f.custody.retain('catalog', batch); assert.deepEqual(f.rows(), committed);
		assert.deepEqual(f.assets().map(immutable), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

for (const mismatch of ['sha256', 'size', 'immutable-root'] as const) test(`a later ${mismatch} conflict rolls back earlier roots and both asset counts`, OPTIONS, async () => {
	const f = await fixture();
	try {
		const locked = ref(f.a, 'locked', 'locked-logical'); await f.custody.retain('catalog', [locked]);
		const before = f.rows(), valid = ref(f.a, 'first-new');
		const invalid = mismatch === 'sha256' ? { ...ref(f.a, 'later'), sha256: '0'.repeat(64) }
			: mismatch === 'size' ? { ...ref(f.a, 'later'), size: f.a.size + 1 } : { ...locked, sourceId: 'changed-logical' };
		await assert.rejects(f.custody.retain('catalog', [valid, ref(f.b, 'second-new'), invalid]),
			mismatch === 'immutable-root' ? /immutable/u : /identity/u);
		assert.deepEqual(f.rows(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

test('a media count write failure retains its original reason and rolls back the complete root batch', OPTIONS, async () => {
	const f = await fixture();
	try {
		await f.custody.retain('other-catalog', [ref(f.a, 'retained')]);
		const before = f.rows(), failure = new Error('Exact native count-write failure');
		f.indexedDB.failNextPutForStore('mediaAssets', failure);
		await assert.rejects(f.custody.retain('catalog', [ref(f.a, 'new-a'), ref(f.b, 'new-b')]), (error: unknown) => error === failure);
		assert.deepEqual(f.rows(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

function interceptPuts(f: Fixture, intercept: (name: string, value: unknown, put: () => IDBRequest<IDBValidKey>) => IDBRequest<IDBValidKey>): () => void {
	const native = f.database.transaction.bind(f.database);
	f.database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		const transaction = native(...args), objectStore = transaction.objectStore.bind(transaction);
		transaction.objectStore = name => {
			const store = objectStore(name), put = store.put.bind(store);
			store.put = (...values: Parameters<IDBObjectStore['put']>) => intercept(name, values[0] as unknown, () => put(...values));
			return store;
		};
		return transaction;
	}) as IDBDatabase['transaction'];
	return () => { f.database.transaction = native; };
}
function afterSettlement(request: IDBRequest, kind: 'onsuccess' | 'onerror', observe: () => void): void {
	let callback: IDBRequest['onsuccess'] = null;
	Object.defineProperty(request, kind, { configurable: true,
		get: () => callback === null ? null : function (this: IDBRequest, event: Event) {
			try { return callback?.call(this, event); } finally { observe(); }
		}, set: (value: IDBRequest['onsuccess']) => { callback = value; } });
}
function isAsset(value: unknown, assetId: string): boolean {
	return typeof value === 'object' && value !== null && 'sourceId' in value && value.sourceId === assetId;
}

test('a late second-asset count failure rolls back the first successful count and every root', OPTIONS, async () => {
	const f = await fixture(), failure = new Error('Second native asset count failed'); let injected = false;
	const restore = interceptPuts(f, (name, value, put) => {
		if (name === 'mediaAssets' && isAsset(value, f.b.assetId)) {
			assert.equal(f.asset(f.a.assetId).catalogRootCount, 1, 'the first asset count write has succeeded');
			injected = true; f.indexedDB.failNextPutForStore('mediaAssets', failure);
		}
		return put();
	});
	try {
		const before = f.rows();
		await assert.rejects(f.custody.retain('catalog', [ref(f.a, 'new-a'), ref(f.b, 'new-b')]), (error: unknown) => error === failure);
		assert.equal(injected, true); assert.deepEqual(f.rows(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { restore(); await f.close(); }
});

for (const boundary of ['root-put', 'final-media-put'] as const) for (const settlement of ['pending', 'after-success'] as const) {
	test(`opaque abort at ${settlement} ${boundary} preserves its reason and joins all rollback`, OPTIONS, async () => {
		const f = await fixture(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); let injected = false;
		const restore = interceptPuts(f, (name, value, put) => {
			const request = put();
			if (!injected && (boundary === 'root-put' ? name === ROOTS : name === 'mediaAssets' && isAsset(value, f.b.assetId))) {
				injected = true;
				if (settlement === 'pending') stop.abort(opaque.proxy);
				else afterSettlement(request, 'onsuccess', () => { stop.abort(opaque.proxy); });
			}
			return request;
		});
		try {
			const before = f.rows();
			await rejectsWithExactReason(f.custody.retain('catalog', [ref(f.a, 'new-a'), ref(f.b, 'new-b')], { signal: stop.signal }), opaque.proxy);
			assert.equal(injected, true); assert.deepEqual(f.rows(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { restore(); await f.close(); }
	});
}

test('a count request failure observed before later cancellation retains the original failure', OPTIONS, async () => {
	const f = await fixture(), stop = new AbortController(), failure = new Error('First observed native failure'), opaque = Proxy.revocable({}, {});
	opaque.revoke(); let injected = false;
	const restore = interceptPuts(f, (name, value, put) => {
		if (!injected && name === 'mediaAssets' && isAsset(value, f.a.assetId)) {
			injected = true; f.indexedDB.failNextPutForStore('mediaAssets', failure);
			const request = put(); afterSettlement(request, 'onerror', () => { stop.abort(opaque.proxy); }); return request;
		}
		return put();
	});
	try {
		const before = f.rows();
		await assert.rejects(f.custody.retain('catalog', [ref(f.a, 'new-a'), ref(f.b, 'new-b')], { signal: stop.signal }),
			(error: unknown) => error === failure);
		assert.equal(injected, true); assert.deepEqual(f.rows(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { restore(); await f.close(); }
});

for (const count of [-1, Number.NaN, Number.MAX_SAFE_INTEGER]) test(`new-root count ${String(count)} refuses before a later reference mismatch`, OPTIONS, async () => {
	const f = await fixture();
	try {
		f.indexedDB.seedRecord(f.name, 'mediaAssets', { ...f.asset(f.a.assetId), catalogRootCount: count });
		const before = f.rows();
		await assert.rejects(f.custody.retain('catalog', [ref(f.a, 'first-new'), { ...ref(f.b, 'later-bad'), size: f.b.size + 1 }]),
			Number.isSafeInteger(count) && count >= 0 ? /count exceeds/u : /count is corrupt/u);
		assert.deepEqual(f.rows(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

test('idempotent roots do not repair corrupt count hints, and cumulative additions still refuse overflow', OPTIONS, async () => {
	const f = await fixture();
	try {
		const existing = ref(f.a, 'existing'); await f.custody.retain('catalog', [existing]);
		f.indexedDB.seedRecord(f.name, 'mediaAssets', { ...f.asset(f.a.assetId), catalogRootCount: -1 });
		const corrupt = f.rows(); await f.custody.retain('catalog', [existing]); assert.deepEqual(f.rows(), corrupt);
		f.indexedDB.seedRecord(f.name, 'mediaAssets', { ...f.asset(f.a.assetId), catalogRootCount: Number.MAX_SAFE_INTEGER - 1 });
		const nearLimit = f.rows();
		await assert.rejects(f.custody.retain('catalog', [existing, ref(f.a, 'new-1'), ref(f.a, 'new-2')]), /count exceeds/u);
		assert.deepEqual(f.rows(), nearLimit); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

test('duplicate photo IDs and a replaced physical source ID cannot become batch custody', OPTIONS, async () => {
	const f = await fixture();
	try {
		const before = f.rows();
		await assert.rejects(f.custody.retain('catalog', [ref(f.a, 'same'), ref(f.b, 'same')]), /unique/u);
		assert.deepEqual(f.rows(), before);
		// The physical row must match assetId; a matching logical sourceId grants nothing.
		f.indexedDB.seedRecord(f.name, 'mediaAssets', { ...f.asset(f.a.assetId), sourceId: 'wrong-physical-source' }, f.a.assetId);
		const replaced = f.rows();
		await assert.rejects(f.custody.retain('catalog', [ref(f.a, 'new', 'wrong-physical-source')]), /identity/u);
		assert.deepEqual(f.rows(), replaced); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

test('opaque cancellation during root reads joins rollback without reflecting its reason', OPTIONS, async () => {
	const f = await fixture(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	try {
		const before = f.rows();
		f.indexedDB.onNextGetForStore(ROOTS, () => { stop.abort(opaque.proxy); });
		await rejectsWithExactReason(f.custody.retain('catalog', [ref(f.a, 'new-a'), ref(f.b, 'new-b')], { signal: stop.signal }), opaque.proxy);
		assert.deepEqual(f.rows(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

test('successful requests do not release batch custody before the native completion event joins', OPTIONS, async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	const native = f.database.transaction.bind(f.database);
	f.database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		const transaction = native(...args); let complete: IDBTransaction['oncomplete'] = null;
		Object.defineProperty(transaction, 'oncomplete', { configurable: true,
			get: () => complete === null ? null : function (this: IDBTransaction, event: Event) {
				entered.resolve(); void release.promise.then(() => { complete?.call(this, event); });
			}, set: (callback: IDBTransaction['oncomplete']) => { complete = callback; } });
		return transaction;
	}) as IDBDatabase['transaction'];
	const work = f.custody.retain('catalog', [ref(f.a, 'new-a'), ref(f.b, 'new-b')]);
	try {
		await Promise.race([entered.promise, work.then(() => { throw new Error('Custody settled before native completion.'); })]);
		assert.equal(await remainsPending(work), true); release.resolve(); await work;
		assert.equal(f.asset(f.a.assetId).catalogRootCount, 1); assert.equal(f.asset(f.b.assetId).catalogRootCount, 1);
	} finally { release.resolve(); try { await work; } finally { f.database.transaction = native; await f.close(); } }
});

interface NativeOperations { transactions: number; mediaReads: number; mediaWrites: number; rootReads: number; rootWrites: number; maximumRootWritesPerTransaction: number }
function observeNativeOperations(f: Fixture) {
	const counts: NativeOperations = { transactions: 0, mediaReads: 0, mediaWrites: 0, rootReads: 0, rootWrites: 0, maximumRootWritesPerTransaction: 0 };
	const native = f.database.transaction.bind(f.database);
	f.database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		const transaction = native(...args), names = typeof args[0] === 'string' ? [args[0]] : Array.from(args[0]);
		if (args[1] !== 'readwrite' || names.length !== 2 || !names.includes('mediaAssets') || !names.includes(ROOTS)) return transaction;
		counts.transactions++; let roots = 0;
		const objectStore = transaction.objectStore.bind(transaction);
		transaction.objectStore = name => {
			const store = objectStore(name), get = store.get.bind(store), put = store.put.bind(store);
			store.get = key => { if (name === ROOTS) counts.rootReads++; else counts.mediaReads++; return get(key); };
			store.put = (...values: Parameters<IDBObjectStore['put']>) => {
				if (name === ROOTS) { counts.rootWrites++; roots++; counts.maximumRootWritesPerTransaction = Math.max(counts.maximumRootWritesPerTransaction, roots); }
				else counts.mediaWrites++;
				return put(...values);
			};
			return store;
		};
		return transaction;
	}) as IDBDatabase['transaction'];
	return { counts, stop: () => { f.database.transaction = native; } };
}

test('L3 same-Original batches retain every native root with bounded scalar IO diagnostics', OPTIONS, async context => {
	const f = await fixture(), observation = observeNativeOperations(f);
	try {
		assert.equal(f.a.size, SPEC.sourceByteLength); assert.equal(f.a.sha256, SPEC.sourceSha256);
		const before = immutable(f.asset(f.a.assetId));
		for (let batch = 0; batch < 2; batch++) await f.custody.retain('catalog', Array.from({ length: SPEC.publicationBatchSize }, (_, offset) =>
			ref(f.a, `large-photo-${String(batch * SPEC.publicationBatchSize + offset).padStart(5, '0')}`)));
		observation.stop();
		assert.equal(observation.counts.transactions, 2); assert.equal(observation.counts.rootWrites, 32);
		assert.equal(observation.counts.maximumRootWritesPerTransaction, SPEC.publicationBatchSize);
		assert.equal(f.asset(f.a.assetId).catalogRootCount, 32); assert.equal(f.indexedDB.recordCount(f.name, ROOTS), 32);
		assert.deepEqual(immutable(f.asset(f.a.assetId)), before);
		const body = await f.store.loadMediaAsset(f.a.assetId); assert.ok(body);
		assert.equal(createHash('sha256').update(new Uint8Array(await body.arrayBuffer())).digest('hex'), SPEC.sourceSha256);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
		// Modeled native request counts expose amplification; this is not timing,
		// browser IO, a heap estimate or the actual 20000-photo acceptance result.
		context.diagnostic(JSON.stringify({ workload: SPEC.id, photos: 32, sourceBytes: SPEC.sourceByteLength, ...observation.counts }));
	} finally { observation.stop(); await f.close(); }
});
