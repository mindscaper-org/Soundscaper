/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { deriveLightscaperNativeCatalogPathsCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { initializeLightscaperNativeCatalogV1FixtureCurrent } from './helpers/lightscaper-native-catalog-v1-schema-fixture-current.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

const root = () => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
	id: 'catalog-1', name: 'Native search', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
const photo = (index: number, schemaVersion = 3) => normalizePhotoDocumentCurrentV1({ ...photoArchiveFixture(index).photo, schemaVersion,
	metadata: { ...photoArchiveFixture(index).photo.metadata, title: index === 1 ? 'Cloud' : 'Stone' } });
const query = (text = '') => ({ schemaVersion: 2, kind: 'photo-catalog-query', text });
async function* bytes() { yield Uint8Array.of(1, 2, 3); }
async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native query owner ')));
	// Retain a failed fixture until the entire verification process is joined.
	await run(directory); await rm(directory, { recursive: true, force: false });
}

test('Lightscaper native query owner starts ready and atomically indexes exact Current1/2/3 imports and edits through reopen', async () => {
	await fixture(async directory => {
		let store = await Store.open({ appDataPath: directory });
		try {
			await store.createCatalog(root()); const empty = await store.readQueryPageV2(root().id);
			assert.equal(empty.totalCount, 0); assert.equal(empty.scanned, 0); assert.equal(empty.continuation, null);
			const values = [photo(1, 1), photo(2, 2), photo(3, 3)];
			for (const value of values) await store.storeOriginal(value.original, bytes());
			await store.publishPhotos(root().id, 0, values);
			const first = await store.readQueryPageV2(root().id, { query: query('cloud') });
			assert.deepEqual(first.items.map(value => value.photoId), [values[0]!.id]); assert.equal(first.scanned, 3);
			const saved = await store.savePhoto({ ...values[0]!, metadata: { ...values[0]!.metadata, title: 'Rain' } }, 0);
			assert.equal((await store.readQueryPageV2(root().id, { query: query('cloud') })).items.length, 0);
			assert.deepEqual((await store.readQueryPageV2(root().id, { query: query('rain') })).items.map(value => value.photoRevision), [1]);
			assert.deepEqual(await store.rebuildQueryIndexPageV2(root().id), { processed: 0, bytes: 0, derivedBytes: 0, ready: true });
			await store.close(); store = await Store.open({ appDataPath: directory });
			assert.equal((await store.readQueryPageV2(root().id)).totalCount, 3);
			assert.deepEqual(await store.loadPhoto(root().id, saved.id), saved);
		} finally { await store.close(); }
	});
});

test('Lightscaper native query SQL refusal rolls back Photo summary membership root and derived counts together', async () => {
	await fixture(async directory => {
		const store = await Store.open({ appDataPath: directory }); let observer: DatabaseSync | undefined;
		try {
			await store.createCatalog(root()); const value = photo(1); await store.storeOriginal(value.original, bytes());
			observer = new DatabaseSync(deriveLightscaperNativeCatalogPathsCurrentV1(directory).databasePath);
			observer.exec("CREATE TRIGGER refuse_query BEFORE INSERT ON native_photo_query_rows_v2 BEGIN SELECT RAISE(ABORT,'query publication failure'); END");
			await assert.rejects(store.publishPhotos(root().id, 0, [value]), /query publication failure/u);
			assert.equal(await store.loadPhoto(root().id, value.id), null); assert.equal((await store.readSnapshot(root().id))?.indexRevision, 0);
			assert.equal((await store.readQueryPageV2(root().id)).totalCount, 0); assert.equal((await store.readSummaryPage(root().id)).items.length, 0);
			observer.exec('DROP TRIGGER refuse_query'); await store.publishPhotos(root().id, 0, [value]);
			observer.exec("CREATE TRIGGER refuse_query BEFORE UPDATE ON native_photo_query_rows_v2 BEGIN SELECT RAISE(ABORT,'query replacement failure'); END");
			await assert.rejects(store.savePhoto({ ...value, rating: 5 }, 0), /query replacement failure/u);
			assert.deepEqual(await store.loadPhoto(root().id, value.id), value); assert.equal((await store.readSnapshot(root().id))?.indexRevision, 1);
			assert.equal((await store.readSummaryPage(root().id)).items[0]?.rating, 0); assert.equal((await store.readQueryPageV2(root().id)).items[0]?.rating, 0);
			observer.exec('DROP TRIGGER refuse_query');
		} finally { observer?.close(); await store.close(); }
	});
});

test('Lightscaper native query owner captures requests before queued file work and refuses accessors without invocation', async () => {
	await fixture(async directory => {
		const store = await Store.open({ appDataPath: directory }), entered = deferred<void>(), release = deferred<void>();
		try {
			await store.createCatalog(root()); const value = photo(1);
			const upload = store.storeOriginal(value.original, (async function* () { entered.resolve(); await release.promise; yield Uint8Array.of(1, 2, 3); })());
			await entered.promise; const imported = store.publishPhotos(root().id, 0, [value]);
			const borrowed = query('cloud'), page = store.readQueryPageV2(root().id, { query: borrowed }); borrowed.text = 'stone';
			let invoked = 0; const hostile = store.readQueryPageV2(root().id, { get query() { invoked++; return borrowed; } });
			const cancelled = new AbortController(), reason = Object.freeze({ source: 'queued query cancelled' });
			const stopped = store.readQueryPageV2(root().id, { signal: cancelled.signal }); cancelled.abort(reason);
			release.resolve(); await upload; await imported;
			assert.deepEqual((await page).items.map(item => item.photoId), [value.id]); await assert.rejects(hostile);
			await assert.rejects(stopped, (error: unknown) => error === reason); assert.equal(invoked, 0);
		} finally { release.resolve(); await store.close(); }
	});
});

test('Lightscaper native query cursors refuse changes committed by another actual owner', async () => {
	await fixture(async directory => {
		const first = await Store.open({ appDataPath: directory }); let second: Store | undefined;
		try {
			await first.createCatalog(root()); const values = Array.from({ length: 65 }, (_, i) => photo(i + 1));
			for (const value of values) await first.storeOriginal(value.original, bytes());
			let revision = 0;
			for (let offset = 0; offset < values.length; offset += 16) await first.publishPhotos(root().id, revision++, values.slice(offset, offset + 16));
			const page = await first.readQueryPageV2(root().id); assert.equal(page.scanned, 64); assert.ok(page.continuation);
			second = await Store.open({ appDataPath: directory }); await second.savePhoto({ ...values[0]!, rating: 4 }, 0);
			await assert.rejects(first.readQueryPageV2(root().id, { continuation: page.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
			const fresh = await first.readQueryPageV2(root().id); assert.ok(fresh.continuation);
			const loaded = await second.loadCatalog(root().id); assert.ok(loaded); await second.saveCatalog({ ...loaded, name: 'Renamed' }, loaded.revision);
			await assert.rejects(first.readQueryPageV2(root().id, { continuation: fresh.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
		} finally { await first.close(); await second?.close(); }
	});
});

test('Lightscaper native writes refuse incoherent query build counts before publishing any catalog or Photo mutation', async () => {
	await fixture(async directory => {
		const store = await Store.open({ appDataPath: directory }); let observer: DatabaseSync | undefined;
		try {
			await store.createCatalog(root()); const initial = photo(1), next = photo(2);
			for (const value of [initial, next]) await store.storeOriginal(value.original, bytes());
			const catalog = await store.publishPhotos(root().id, 0, [initial]);
			observer = new DatabaseSync(deriveLightscaperNativeCatalogPathsCurrentV1(directory).databasePath);
			const database = observer;
			const tables = ['native_photo_catalogs', 'native_photos', 'native_photo_memberships', 'native_photo_query_rows_v2', 'native_photo_query_builds_v2'];
			const snapshot = () => tables.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
			for (const [ready, count] of [[1, 2], [0, 2], [1, 0]] as const) {
				database.prepare('UPDATE native_photo_query_builds_v2 SET ready=?,indexed_count=?').run(ready, count);
				const before = snapshot();
				await assert.rejects(store.savePhoto({ ...initial, rating: 5 }, 0), /query.*count|build/iu);
				assert.deepEqual(snapshot(), before);
				await assert.rejects(store.publishPhotos(root().id, 1, [next]), /query.*count|build/iu);
				assert.deepEqual(snapshot(), before);
				await assert.rejects(store.saveCatalog({ ...catalog, name: 'Refused' }, 1), /query.*count|build/iu);
				assert.deepEqual(snapshot(), before);
			}
			database.exec('DELETE FROM native_photo_query_builds_v2'); const before = snapshot();
			await assert.rejects(store.saveCatalog({ ...catalog, name: 'Missing build' }, 1), /query.*count|build/iu);
			assert.deepEqual(snapshot(), before);
		} finally { observer?.close(); await store.close(); }
	});
});

test('Lightscaper native owner upgrades a historical disk library and resumes bounded queries while ordinary writes continue', async () => {
	await fixture(async directory => {
		const paths = deriveLightscaperNativeCatalogPathsCurrentV1(directory); await mkdir(paths.libraryRoot, { recursive: true });
		const historical = new DatabaseSync(paths.databasePath), values = Array.from({ length: 65 }, (_, index) => photo(index + 1, 1 + index % 3));
		try {
			initializeLightscaperNativeCatalogV1FixtureCurrent(historical);
			const catalog = { ...root(), revision: 7, photoCount: values.length };
			historical.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(catalog.id, serializeLightscaperDocumentV1(catalog), 7, 65, 9);
			for (const value of values) historical.prepare('INSERT INTO native_photos VALUES (?,?,?,?,?,?)').run(
				photoStorageKey(value.catalogId, value.id), value.catalogId, value.id, value.revision, serializePhotoDocumentCurrentV1(value), JSON.stringify(photoSummary(value)));
		} finally { historical.close(); }
		let store = await Store.open({ appDataPath: directory });
		try {
			// Historical Originals are deliberately absent: a derived metadata
			// rebuild cannot require image bodies, decoders or resource services.
			await assert.rejects(store.readQueryPageV2(root().id), { code: 'PHOTO_QUERY_INDEX_NOT_READY' });
			assert.equal((await store.rebuildQueryIndexPageV2(root().id)).processed, 16);
			await store.close(); store = await Store.open({ appDataPath: directory });
			const changed = await store.savePhoto({ ...values[0]!, metadata: { ...values[0]!.metadata, title: 'Rain' } }, 0);
			await store.savePhoto({ ...values[8]!, rating: 5 }, 0);
			const extra = normalizePhotoDocumentCurrentV1({ ...photo(66), id: 'photo-0' });
			await store.storeOriginal(extra.original, bytes()); await store.publishPhotos(root().id, 7, [extra]);
			let ready = false;
			for (let step = 0; step < 10 && !ready; step++) {
				const progress = await store.rebuildQueryIndexPageV2(root().id); assert.ok(progress.processed <= 16); ready = progress.ready;
			}
			assert.equal(ready, true); assert.equal((await store.readQueryPageV2(root().id)).totalCount, 66);
			assert.deepEqual((await store.readQueryPageV2(root().id, { query: query('rain') })).items.map(value => value.photoId), [changed.id]);
			for (const value of values.slice(0, 3)) assert.equal((await store.loadPhoto(root().id, value.id))?.schemaVersion, value.schemaVersion);
		} finally { await store.close(); }
	});
});
