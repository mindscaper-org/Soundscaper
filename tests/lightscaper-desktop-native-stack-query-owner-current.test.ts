/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { deriveLightscaperNativeCatalogPathsCurrentV1, initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import type { PhotoStackQueryPageRequestV2, PhotoStackQueryPageV2, PhotoStackQueryContinuationV2 } from '../src/lightscaper/catalog/photo-stack-query-types-v2.ts';
import { nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';
import { CATALOG, photoId, seedNativeStackQueryCurrentV1 as seed, expectedNativeStackQueryCurrentV1 as expected,
	stackQueryCurrentV1 as query, type NativeStackQuerySeedOptionsCurrentV1 } from './helpers/lightscaper-native-stack-query-fixture-current.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

/** Import only E76's actual owner and existing fixture dependencies. The first
 * assertion happens AFTER genuine native seed/open, so RED is missing method,
 * not a new-page-module import failure. No IDB facade is involved. */
function read(store: Store, options: PhotoStackQueryPageRequestV2 = {}): Promise<PhotoStackQueryPageV2> {
	const method: unknown = Reflect.get(store, 'readStackQueryPageV2');
	assert.equal(typeof method, 'function', 'The actual seeded native catalog owner must expose readStackQueryPageV2.');
	return Reflect.apply(method as (catalogId: string, options: PhotoStackQueryPageRequestV2) => Promise<PhotoStackQueryPageV2>, store, [CATALOG, options]);
}
async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native collapsed owner ü ')));
	// A failed retirement retains only this owned fixture until the test process joins.
	await run(directory); await rm(directory, { recursive: true, force: false });
}
async function seedOwner(directory: string, count = 130, options: NativeStackQuerySeedOptionsCurrentV1 = {}) {
	const paths = deriveLightscaperNativeCatalogPathsCurrentV1(directory); await mkdir(paths.libraryRoot, { recursive: true });
	const database = new DatabaseSync(paths.databasePath);
	try { initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.exec('PRAGMA journal_mode=WAL'); return seed(database, count, options); }
	finally { database.close(); }
}
const large = { groups: [{ indices: Array.from({ length: 130 }, (_, index) => index), cover: 0 }] };
async function collect(store: Store) {
	const ids: string[] = []; let continuation: PhotoStackQueryContinuationV2 | null = null, steps = 0;
	do {
		const page = await read(store, { continuation }); assert.ok(page.scanned <= 64 && steps++ < 20);
		ids.push(...page.items.map(item => item.photoId)); continuation = page.continuation;
	} while (continuation);
	return ids;
}
async function heldUpload(store: Store, entered: ReturnType<typeof deferred<void>>, release: ReturnType<typeof deferred<void>>) {
	await store.storeOriginal(nativePhotoCurrentV1(999).original, (async function* () {
		entered.resolve(); await release.promise; yield Uint8Array.of(1, 2, 3);
	})());
}

test('Lightscaper native collapsed owner has a genuine method after seed and persists grouping metadata through reopen without Original bodies', async () => {
	await fixture(async directory => {
		const f = await seedOwner(directory, 130, large); let store = await Store.open({ appDataPath: directory });
		try {
			const first = await read(store); assert.deepEqual(first.items, []); assert.ok(first.continuation?.pending);
			assert.deepEqual(await collect(store), expected(f, query()));
			await store.close(); store = await Store.open({ appDataPath: directory });
			await assert.rejects(read(store, { continuation: first.continuation }), /signature|authentication|progress/iu);
			assert.deepEqual(await collect(store), [photoId(0)]);
		} finally { await store.close(); }
	});
});

test('Lightscaper native collapsed owner captures detached query and nested cursor before held Original work', async () => {
	await fixture(async directory => {
		await seedOwner(directory, 130, large); const store = await Store.open({ appDataPath: directory }), entered = deferred<void>(), release = deferred<void>();
		let upload: Promise<void> | undefined, page: Promise<PhotoStackQueryPageV2> | undefined, resumed: Promise<PhotoStackQueryPageV2> | undefined;
		try {
			const first = await read(store); assert.ok(first.continuation?.pending);
			upload = heldUpload(store, entered, release); await entered.promise;
			const borrowed = { schemaVersion: 2, kind: 'photo-catalog-query', text: '' }, nested = { ...first.continuation, pending: { ...first.continuation.pending } };
			page = read(store, { query: borrowed }); resumed = read(store, { continuation: nested });
			borrowed.text = 'Does not match'; nested.pending.nextMember = 130;
			assert.equal(await remainsPending(page), true); release.resolve(); await upload;
			assert.ok((await page).continuation?.pending); assert.ok((await resumed).continuation?.pending);
			assert.equal((await resumed).items.length, 0);
		} finally { release.resolve(); await Promise.allSettled([upload, page, resumed]); await store.close(); }
	});
});

test('Lightscaper native collapsed owner rejects getters and preserves exact opaque cancellation while queued', async () => {
	await fixture(async directory => {
		await seedOwner(directory, 2); const store = await Store.open({ appDataPath: directory }), entered = deferred<void>(), release = deferred<void>();
		let upload: Promise<void> | undefined, hostile: Promise<PhotoStackQueryPageV2> | undefined, stopped: Promise<PhotoStackQueryPageV2> | undefined, invoked = 0, traps = 0;
		const caller = new AbortController(), reason = new Proxy({}, { get() { traps++; throw Error('Opaque reason read.'); }, getPrototypeOf() { traps++; throw Error('Opaque reason prototype.'); } });
		try {
			// Assert the E77 method only after opening actual seeded storage.
			await read(store); upload = heldUpload(store, entered, release); await entered.promise;
			hostile = read(store, { get query() { invoked++; return query(); } }); const refused = assert.rejects(hostile);
			stopped = read(store, { signal: caller.signal });
			// assert.rejects fulfills an internal promise with its captured reason,
			// which would inspect an opaque Proxy's `then` during assimilation.
			const cancelled = stopped.then(() => assert.fail('Queued cancellation must refuse.'), (error: unknown) => { assert.equal(error, reason); }); caller.abort(reason);
			release.resolve(); await upload; await refused; await cancelled; assert.equal(invoked, 0); assert.equal(traps, 0);
			assert.equal((await read(store)).totalCount, 2);
		} finally { release.resolve(); await Promise.allSettled([upload, hostile, stopped]); await store.close(); }
	});
});

test('Lightscaper native collapsed owner close fences new reads and joins a pending admitted read behind real file work', async () => {
	await fixture(async directory => {
		await seedOwner(directory, 130, large); const store = await Store.open({ appDataPath: directory }), entered = deferred<void>(), release = deferred<void>();
		let upload: Promise<void> | undefined, page: Promise<PhotoStackQueryPageV2> | undefined, closing: Promise<void> | undefined;
		try {
			await read(store); upload = heldUpload(store, entered, release); await entered.promise; page = read(store); closing = store.close();
			assert.equal(await remainsPending(closing), true); assert.equal(await remainsPending(page), true);
			await assert.rejects(read(store), { code: 'CATALOG_CLOSED' });
			release.resolve(); await upload; assert.ok((await page).continuation?.pending); await closing; assert.equal(store.close(), closing);
		} finally { release.resolve(); await Promise.allSettled([upload, page, closing]); await store.close(); }
	});
});

test('Lightscaper native collapsed owner registers its read before Proxy admission can request close', async () => {
	await fixture(async directory => {
		await seedOwner(directory, 2); const store = await Store.open({ appDataPath: directory }); let closing: Promise<void> | undefined, trapped = false;
		try {
			await read(store);
			const borrowed = new Proxy({ query: query() }, { ownKeys(target) { if (!trapped) { trapped = true; closing = store.close(); } return Reflect.ownKeys(target); } });
			const page = read(store, borrowed); assert.equal(trapped, true); assert.ok(closing);
			assert.equal((await page).totalCount, 2); await closing; await assert.rejects(read(store), { code: 'CATALOG_CLOSED' });
		} finally { await store.close(); }
	});
});
