/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { deriveLightscaperNativeCatalogPathsCurrentV1, initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import type { PhotoQueryPageRequestV1, PhotoQueryPageV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import type { PhotoStackQueryPageRequestV1, PhotoStackQueryPageV1 } from '../src/lightscaper/catalog/photo-stack-query-types-v1.ts';
import { nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';
import { CATALOG, photoId, seedNativeStackQueryCurrentV1 as seed } from './helpers/lightscaper-native-stack-query-fixture-current.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Build = Readonly<{ processed: number; bytes: number; ready: boolean }>;
function invoke<Arguments extends unknown[], Result>(store: Store, name: string, args: Arguments): Promise<Result> {
	const method: unknown = Reflect.get(store, name);
	assert.equal(typeof method, 'function', `The genuinely seeded native owner must implement ${name}.`);
	return Reflect.apply(method as (...values: Arguments) => Promise<Result>, store, args);
}
const read = (store: Store, options: PhotoQueryPageRequestV1 = {}) => invoke<[string, PhotoQueryPageRequestV1], PhotoQueryPageV1>(store, 'readQueryPage', [CATALOG, options]);
const collapsed = (store: Store, options: PhotoStackQueryPageRequestV1 = {}) => invoke<[string, PhotoStackQueryPageRequestV1], PhotoStackQueryPageV1>(store, 'readStackQueryPage', [CATALOG, options]);
const rebuild = (store: Store, options: Readonly<{ signal?: AbortSignal }> = {}) => invoke<[string, Readonly<{ signal?: AbortSignal }>], Build>(store, 'rebuildQueryIndexPage', [CATALOG, options]);
async function ready(store: Store): Promise<void> {
	for (let step = 0; step < 20; step++) { const result = await rebuild(store); assert.ok(result.processed <= 16); if (result.ready) return; }
	assert.fail('Actual bounded legacy rebuild must exhaust this fixture.');
}
async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper legacy owner ü ')));
	await run(directory); await rm(directory, { recursive: true, force: false });
}
/** No new reader/signer/helper import. This works against actual E77: seed its
 * existing schema/Photos/Query2/stacks first, then report a missing method.
 * After schema4 exists the same fixture creates an authentic unready Build1. */
async function seedOwner(directory: string, count = 130) {
	const paths = deriveLightscaperNativeCatalogPathsCurrentV1(directory); await mkdir(paths.libraryRoot, { recursive: true });
	const database = new DatabaseSync(paths.databasePath);
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.exec('PRAGMA journal_mode=WAL');
		seed(database, count, { groups: [{ indices: Array.from({ length: count }, (_, index) => index), cover: 0 }] });
		if (database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='native_photo_query_builds_v1'").get() !== undefined) {
			database.prepare('INSERT INTO native_photo_query_builds_v1(catalog_id,ready,after_key,indexed_count) VALUES(?,0,NULL,0)').run(CATALOG);
		}
	} finally { database.close(); }
}
async function upload(store: Store, entered: ReturnType<typeof deferred<void>>, release: ReturnType<typeof deferred<void>>): Promise<void> {
	await store.storeOriginal(nativePhotoCurrentV1(999).original, (async function* () { entered.resolve(); await release.promise; yield Uint8Array.of(1, 2, 3); })());
}

test('Lightscaper native legacy owner exposes actual readQueryPage after real FS and SQLite seed', async () => {
	await fixture(async directory => {
		await seedOwner(directory); const store = await Store.open({ appDataPath: directory });
		try {
			// On E77 the invocation fails the missing-method assertion, not import resolution.
			await assert.rejects(async () => { await read(store); }, { code: 'PHOTO_QUERY_INDEX_NOT_READY' });
			await ready(store); const page = await read(store);
			assert.deepEqual(Object.keys(page).sort(), ['continuation', 'items', 'scanned']); assert.equal(page.scanned, 64); assert.equal(page.items[0]?.photoId, photoId(0));
		} finally { await store.close(); }
	});
});

test('Lightscaper native legacy owner exposes actual rebuildQueryIndexPage and resumes exact V1 receipts after reopen', async () => {
	await fixture(async directory => {
		await seedOwner(directory); let store = await Store.open({ appDataPath: directory });
		try {
			const result = await rebuild(store); assert.deepEqual(Object.keys(result).sort(), ['bytes', 'processed', 'ready']); assert.equal(result.processed, 16); assert.ok(result.bytes > 0); assert.equal(result.ready, false);
			await store.close(); store = await Store.open({ appDataPath: directory }); await ready(store); assert.equal((await read(store)).scanned, 64);
		} finally { await store.close(); }
	});
});

test('Lightscaper native legacy owner exposes actual readStackQueryPage with exact five-field page and retired issuing authority', async () => {
	await fixture(async directory => {
		await seedOwner(directory); let store = await Store.open({ appDataPath: directory });
		try {
			await assert.rejects(async () => { await collapsed(store); }, { code: 'PHOTO_QUERY_INDEX_NOT_READY' });
			await ready(store); const first = await collapsed(store); assert.ok(first.continuation?.pending);
			assert.deepEqual(Object.keys(first).sort(), ['catalogName', 'continuation', 'items', 'scanned', 'totalCount']); assert.deepEqual(Object.keys(first.continuation).sort(), ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'stateRevision', 'querySha256', 'captureBucket', 'afterKey', 'pending', 'stackAudit', 'progressSha256'].sort());
			await store.close(); store = await Store.open({ appDataPath: directory });
			await assert.rejects(collapsed(store, { continuation: first.continuation }), /signature|authentication|progress/iu);
			assert.equal((await store.readStackQueryPageV2(CATALOG)).kind, 'collapsed-photo-query-page');
		} finally { await store.close(); }
	});
});

test('Lightscaper native legacy owner captures ordinary query and collapsed nested cursor before held Original upload', async () => {
	await fixture(async directory => {
		await seedOwner(directory); const store = await Store.open({ appDataPath: directory }), entered = deferred<void>(), release = deferred<void>();
		let writing: Promise<void> | undefined, ordinary: Promise<PhotoQueryPageV1> | undefined, stackPage: Promise<PhotoStackQueryPageV1> | undefined;
		try {
			await ready(store); const first = await collapsed(store); assert.ok(first.continuation?.pending);
			writing = upload(store, entered, release); await entered.promise;
			const borrowed = { text: '' }, nested = { ...first.continuation, pending: { ...first.continuation.pending } };
			ordinary = read(store, { query: borrowed }); stackPage = collapsed(store, { continuation: nested }); borrowed.text = 'missing'; nested.pending.nextMember = 130;
			assert.equal(await remainsPending(ordinary), true); release.resolve(); await writing;
			assert.equal((await ordinary).items.length, 64); assert.equal((await stackPage).items.length, 0); assert.ok((await stackPage).continuation?.pending);
		} finally { release.resolve(); await Promise.allSettled([writing, ordinary, stackPage]); await store.close(); }
	});
});

test('Lightscaper native legacy owner keeps exact opaque queued abort and refuses hostile getters without assimilation', async () => {
	await fixture(async directory => {
		await seedOwner(directory, 2); const store = await Store.open({ appDataPath: directory }), entered = deferred<void>(), release = deferred<void>();
		let writing: Promise<void> | undefined, stopped: Promise<PhotoStackQueryPageV1> | undefined, hostile: Promise<PhotoQueryPageV1> | undefined, traps = 0, getters = 0;
		const caller = new AbortController(), reason = new Proxy({}, { get() { traps++; throw Error('Opaque reason read.'); }, getPrototypeOf() { traps++; throw Error('Opaque reason prototype.'); } });
		try {
			await ready(store); writing = upload(store, entered, release); await entered.promise;
			hostile = read(store, { get query() { getters++; return {}; } }); const hostileJoined = hostile.then(() => assert.fail('Getter request was accepted.'), () => undefined);
			stopped = collapsed(store, { signal: caller.signal }); const joined = stopped.then(() => assert.fail('Abort was ignored.'), (error: unknown) => { assert.equal(error, reason); }); caller.abort(reason);
			release.resolve(); await writing; await hostileJoined; await joined; assert.equal(traps, 0); assert.equal(getters, 0); assert.equal((await read(store)).items.length, 2);
		} finally { release.resolve(); await Promise.allSettled([writing, stopped, hostile]); await store.close(); }
	});
});

test('Lightscaper native legacy owner close joins all three admitted ports before retiring both signer domains', async () => {
	await fixture(async directory => {
		await seedOwner(directory); const store = await Store.open({ appDataPath: directory }), entered = deferred<void>(), release = deferred<void>();
		let writing: Promise<void> | undefined, ordinary: Promise<PhotoQueryPageV1> | undefined, stackPage: Promise<PhotoStackQueryPageV1> | undefined, building: Promise<Build> | undefined, closing: Promise<void> | undefined;
		try {
			await ready(store); writing = upload(store, entered, release); await entered.promise;
			ordinary = read(store); stackPage = collapsed(store); building = rebuild(store); closing = store.close();
			assert.equal(await remainsPending(closing), true); assert.equal(await remainsPending(stackPage), true);
			await assert.rejects(read(store), { code: 'CATALOG_CLOSED' }); await assert.rejects(collapsed(store), { code: 'CATALOG_CLOSED' }); await assert.rejects(rebuild(store), { code: 'CATALOG_CLOSED' });
			release.resolve(); await writing; assert.equal((await ordinary).scanned, 64); assert.ok((await stackPage).continuation?.pending); assert.equal((await building).ready, true); await closing;
		} finally { release.resolve(); await Promise.allSettled([writing, ordinary, stackPage, building, closing]); await store.close(); }
	});
});

test('Lightscaper native legacy owner registers collapsed work before Proxy admission requests close', async () => {
	await fixture(async directory => {
		await seedOwner(directory, 2); const store = await Store.open({ appDataPath: directory }); let closing: Promise<void> | undefined, trapped = false;
		try {
			await ready(store); const borrowed = new Proxy({ query: {} }, { ownKeys(target) { if (!trapped) { trapped = true; closing = store.close(); } return Reflect.ownKeys(target); } });
			const work = collapsed(store, borrowed); assert.equal(trapped, true); assert.ok(closing); assert.equal((await work).items[0]?.photoId, photoId(0)); await closing;
		} finally { await store.close(); }
	});
});
