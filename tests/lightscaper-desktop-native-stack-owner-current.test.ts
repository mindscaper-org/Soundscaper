/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { deriveLightscaperNativeCatalogPathsCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { writeLightscaperNativeQueryPhotoCurrentV1 } from '../desktop/lightscaper-native-query-write-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { initializeLightscaperNativeCatalogV2FixtureCurrent } from './helpers/lightscaper-native-catalog-v2-schema-fixture-current.ts';

const root = () => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
	id: 'catalog-1', name: 'Native stacks', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
const photo = (index: number) => normalizePhotoDocumentCurrentV1({ ...photoArchiveFixture(index).photo, schemaVersion: 3 });
const stack = () => normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: root().id, id: 'stack',
	revision: 0, photoIds: [photo(2).id, photo(1).id], coverPhotoId: photo(2).id });
const options = (catalog: number, state: number) => ({ expectedCatalogRevision: catalog, expectedStateRevision: state });
async function* bytes() { yield Uint8Array.of(1, 2, 3); }
async function seed(store: Store): Promise<void> {
	await store.createCatalog(root()); const values = [photo(1), photo(2), photo(3)];
	for (const value of values) await store.storeOriginal(value.original, bytes());
	await store.publishPhotos(root().id, 0, values);
}
async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native stack owner ü ')));
	// A failed retirement keeps diagnostics until the complete process has joined.
	await run(directory); await rm(directory, { recursive: true, force: false });
}

test('Lightscaper native stack owner persists grouping and monotonic dissolve state without changing Photo documents or Original bytes', async () => {
	await fixture(async directory => {
		let store = await Store.open({ appDataPath: directory });
		try {
			await seed(store); assert.equal((await store.readStackState(root().id)).revision, 0);
			const saved = await store.saveStack(stack(), null, options(1, 0)); assert.equal(saved.revision, 0);
			assert.deepEqual(await store.loadStack(root().id, saved.id), saved);
			assert.equal((await store.readSnapshot(root().id))?.catalog.revision, 2);
			assert.equal((await store.readSnapshot(root().id))?.indexRevision, 2);
			assert.deepEqual((await store.readStackPage(root().id)).items, [{ catalogId: root().id, id: saved.id,
				revision: 0, photoCount: 2, coverPhotoId: photo(2).id }]);
			assert.deepEqual((await store.readStackMembershipPage(root().id, { photoIds: [photo(2).id, photo(3).id, photo(1).id] })).items.map(value => value.photoId), [photo(2).id, photo(1).id]);
			assert.deepEqual((await store.readStackMemberPage(root().id, saved.id, 0, [photo(1).id, photo(2).id])).map(value => value.photoId), [photo(1).id, photo(2).id]);
			const revised = await store.saveStack({ ...saved, photoIds: [photo(3).id, photo(1).id], coverPhotoId: photo(1).id }, 0, options(2, 1));
			assert.equal(revised.revision, 1); assert.equal((await store.readStackMembershipPage(root().id, { photoIds: [photo(2).id] })).items.length, 0);
			for (const value of [photo(1), photo(2), photo(3)]) {
				assert.deepEqual(await store.loadPhoto(root().id, value.id), value);
				assert.deepEqual(await store.readOriginal(root().id, value.id, 0, 3), Uint8Array.of(1, 2, 3));
			}
			const dissolved = await store.dissolveStack(root().id, revised.id, 1, options(3, 2)); assert.equal(dissolved.revision, 3); assert.equal(dissolved.stackCount, 0);
			assert.equal(await store.loadStack(root().id, revised.id), null); await store.close(); store = await Store.open({ appDataPath: directory });
			assert.deepEqual(await store.readStackState(root().id), dissolved);
			await store.saveStack({ ...stack(), id: 'new' }, null, options(4, 3)); assert.equal((await store.readStackState(root().id)).revision, 4);
			assert.equal((await store.readQueryPageV2(root().id)).catalogRevision, 5);
		} finally { await store.close(); }
	});
});

test('Lightscaper native stack owner preserves catalog/state CAS across independent connections and permits intervening Photo edits', async () => {
	await fixture(async directory => {
		const first = await Store.open({ appDataPath: directory }); let second: Store | undefined;
		try {
			await seed(first); const saved = await first.saveStack(stack(), null, options(1, 0)); second = await Store.open({ appDataPath: directory });
			await assert.rejects(second.saveStack({ ...saved, coverPhotoId: photo(1).id }, 0, options(1, 1)), { code: 'CATALOG_REVISION_CONFLICT' });
			await assert.rejects(second.saveStack({ ...saved, coverPhotoId: photo(1).id }, 0, options(2, 0)), { code: 'STACK_REVISION_CONFLICT' });
			await second.savePhoto({ ...photo(1), rating: 4 }, 0);
			const revised = await first.saveStack({ ...saved, coverPhotoId: photo(1).id }, 0, options(2, 1));
			assert.equal(revised.revision, 1); assert.equal((await second.readSnapshot(root().id))?.indexRevision, 4);
			await assert.rejects(second.dissolveStack(root().id, saved.id, 0, options(3, 2)), { code: 'STACK_REVISION_CONFLICT' });
			assert.equal((await second.loadStack(root().id, saved.id))?.coverPhotoId, photo(1).id);
		} finally { await first.close(); await second?.close(); }
	});
});

test('Lightscaper native stack owner captures queued documents, revisions and point pages before a joined upload completes', async () => {
	await fixture(async directory => {
		const store = await Store.open({ appDataPath: directory }), entered = deferred<void>(), release = deferred<void>();
		try {
			await seed(store); const upload = store.storeOriginal(photo(4).original, (async function* () { entered.resolve(); await release.promise; yield Uint8Array.of(1, 2, 3); })());
			await entered.promise; const borrowed = structuredClone(stack()), expected = options(1, 0);
			const saved = store.saveStack(borrowed, null, expected), ids = [photo(2).id, photo(1).id];
			const page = store.readStackMembershipPage(root().id, { photoIds: ids });
			Reflect.set(borrowed.photoIds, 0, 'missing'); expected.expectedCatalogRevision = 999; ids[0] = 'missing';
			const closing = store.close(); assert.equal(await remainsPending(closing), true);
			await assert.rejects(store.readStackState(root().id), { code: 'CATALOG_CLOSED' });
			release.resolve(); await upload; assert.deepEqual(await saved, stack()); assert.deepEqual((await page).items.map(value => value.photoId), [photo(2).id, photo(1).id]); await closing;
		} finally { release.resolve(); await store.close(); }
	});
});

test('Lightscaper native stack cancellation stays joined and leaves every grouping row absent', async () => {
	await fixture(async directory => {
		let store = await Store.open({ appDataPath: directory }); const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		try {
			await seed(store); const upload = store.storeOriginal(photo(4).original, (async function* () { entered.resolve(); await release.promise; yield Uint8Array.of(1, 2, 3); })());
			await entered.promise; const save = store.saveStack(stack(), null, { ...options(1, 0), signal: stop.signal });
			const reason = Object.freeze({ source: 'native stack queue cancelled' }); stop.abort(reason);
			assert.equal(await remainsPending(save), true); const close = store.close(); release.resolve(); await upload;
			await assert.rejects(save, (error: unknown) => error === reason); await close; store = await Store.open({ appDataPath: directory });
			assert.equal((await store.readStackState(root().id)).stackCount, 0); assert.equal(await store.loadStack(root().id, stack().id), null);
			assert.deepEqual((await store.readStackMembershipPage(root().id)).items, []);
		} finally { release.resolve(); await store.close(); }
	});
});

test('Lightscaper native stack admission refuses getters without invoking them and registers reentrant close before validation', async () => {
	await fixture(async directory => {
		const store = await Store.open({ appDataPath: directory }); let invoked = 0, closing: Promise<void> | undefined, trapped = false;
		try {
			await seed(store);
			await assert.rejects(store.saveStack({ ...stack(), get coverPhotoId() { invoked++; return photo(1).id; } }, null, options(1, 0)));
			await assert.rejects(store.readStackPage(root().id, { get continuation() { invoked++; return null; } })); assert.equal(invoked, 0);
			const borrowed = new Proxy(stack(), { ownKeys(target) { if (!trapped) { trapped = true; closing = store.close(); } return Reflect.ownKeys(target); } });
			const saved = store.saveStack(borrowed, null, options(1, 0)); assert.equal(trapped, true); assert.deepEqual(await saved, stack()); await closing;
		} finally { await store.close(); }
	});
});

test('Lightscaper native stack owner upgrades a historical disk library without opening unavailable Original bodies', async () => {
	await fixture(async directory => {
		const paths = deriveLightscaperNativeCatalogPathsCurrentV1(directory); await mkdir(paths.libraryRoot, { recursive: true });
		const historical = new DatabaseSync(paths.databasePath), values = [photo(1), photo(2), photo(3)];
		try {
			initializeLightscaperNativeCatalogV2FixtureCurrent(historical); historical.exec('BEGIN IMMEDIATE');
			const catalog = { ...root(), revision: 2, photoCount: 3 };
			historical.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(catalog.id, serializeLightscaperDocumentV1(catalog), 2, 3, 4);
			historical.prepare('INSERT INTO native_photo_query_builds_v2 VALUES (?,1,NULL,0)').run(catalog.id);
			for (const value of values) {
				historical.prepare('INSERT INTO native_photos VALUES (?,?,?,?,?,?)').run(photoStorageKey(value.catalogId, value.id), value.catalogId,
					value.id, value.revision, serializePhotoDocumentCurrentV1(value), JSON.stringify(photoSummary(value)));
				writeLightscaperNativeQueryPhotoCurrentV1(historical, value, 'insert');
			}
			historical.exec('COMMIT');
		} finally { historical.close(); }
		const store = await Store.open({ appDataPath: directory });
		try {
			assert.equal((await store.readStackState(root().id)).revision, 0);
			assert.deepEqual(await store.saveStack(stack(), null, options(2, 0)), stack());
			assert.equal((await store.readSnapshot(root().id))?.indexRevision, 5);
			assert.equal((await store.readQueryPageV2(root().id)).totalCount, 3);
			for (const value of values) assert.deepEqual(await store.loadPhoto(root().id, value.id), value);
			await assert.rejects(store.readOriginal(root().id, photo(1).id, 0, 3));
		} finally { await store.close(); }
	});
});
