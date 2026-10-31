/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { admitLightscaperNativeCatalogPhotosCurrentV1 } from '../desktop/lightscaper-native-catalog-admission-current-v1.ts';
import { createLightscaperNativeCatalogCurrentV1 as create, loadLightscaperNativeCatalogCurrentV1 as loadRoot,
	loadLightscaperNativePhotoCurrentV1 as loadPhoto, publishLightscaperNativePhotosCurrentV1 as publish,
	publishDerivedLightscaperNativePhotoCurrentV1 as publishDerived, saveLightscaperNativePhotoCurrentV1 as savePhoto,
	saveLightscaperNativeCatalogCurrentV1 as saveRoot } from '../desktop/lightscaper-native-catalog-transactions-current-v1.ts';
import { LightscaperNativeOriginalStoreCurrentV1 } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { capturePhotoDerivedPublicationGuardCurrentV1 } from '../src/lightscaper/catalog/photo-derived-publication-current-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const root = () => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
	id: 'catalog-1', name: 'Native Ω', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
const photo = (index = 1, schemaVersion = 1) => normalizePhotoDocumentCurrentV1({ ...photoArchiveFixture(index).photo, schemaVersion });
const ports = { verifyOriginal: async () => undefined };
function database(): DatabaseSync {
	const db = new DatabaseSync(':memory:'); initializeLightscaperNativeCatalogDatabaseCurrentV1(db); return db;
}
const imported = (db: DatabaseSync, values: readonly unknown[]) => admitLightscaperNativeCatalogPhotosCurrentV1(db, values, 'import', ports);
const edited = (db: DatabaseSync, value: unknown) => admitLightscaperNativeCatalogPhotosCurrentV1(db, [value], 'edit', {});
const index = (db: DatabaseSync) => db.prepare('SELECT root_revision, photo_count, index_revision FROM native_photo_catalogs WHERE id = ?').get(root().id);
function count(db: DatabaseSync, table: string): number { return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count); }

test('Lightscaper native catalog creates detached exact roots and refuses duplicate or populated creation', () => {
	const db = database();
	try {
		assert.equal(loadRoot(db, root().id), null); assert.equal(loadPhoto(db, root().id, 'missing'), null);
		create(db, root()); assert.deepEqual(loadRoot(db, root().id), root());
		assert.deepEqual({ ...index(db) }, { root_revision: 0, photo_count: 0, index_revision: 0 });
		assert.throws(() => create(db, root()));
		assert.throws(() => create(db, { ...root(), id: 'populated', photoCount: 1 }));
		assert.throws(() => create(db, { ...root(), id: 'advanced', revision: 1 }));
	} finally { db.close(); }
});

test('Lightscaper native catalog persists exact declared Photo1/2/3 documents and scalar projections through reopen', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native catalog ')));
	let db = new DatabaseSync(join(directory, 'catalog.sqlite3'));
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(db); create(db, root());
		const values = [photo(1, 1), photo(2, 2), photo(3, 3)];
		assert.equal(publish(db, root().id, 0, await imported(db, values)).photoCount, 3);
		assert.equal(count(db, 'native_photo_memberships'), 9);
		for (const value of values) {
			assert.equal(serializePhotoDocumentCurrentV1(loadPhoto(db, root().id, value.id)), serializePhotoDocumentCurrentV1(value));
			assert.equal(db.prepare('SELECT summary FROM native_photos WHERE photo_id = ?').get(value.id)?.summary !== undefined, true);
		}
		db.close(); db = new DatabaseSync(join(directory, 'catalog.sqlite3')); initializeLightscaperNativeCatalogDatabaseCurrentV1(db);
		for (const value of values) assert.deepEqual(loadPhoto(db, root().id, value.id), value);
		assert.deepEqual({ ...index(db) }, { root_revision: 1, photo_count: 3, index_revision: 1 });
	} finally { db.close(); await rm(directory, { recursive: true, force: false }); }
});

test('Lightscaper native catalog import requires genuine immutable managed Original custody while edit does no body read', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper catalog original ')));
	const db = database(), store = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath: directory });
	try {
		create(db, root()); const value = photo(), options = { verifyOriginal: (original: typeof value.original, signal?: AbortSignal) => store.verify(original, { signal }) };
		await assert.rejects(admitLightscaperNativeCatalogPhotosCurrentV1(db, [value], 'import', options));
		assert.equal(count(db, 'native_photos'), 0);
		await store.store(value.original, (async function* () { yield Uint8Array.of(1, 2, 3); })());
		publish(db, root().id, 0, await admitLightscaperNativeCatalogPhotosCurrentV1(db, [value], 'import', options));
		await store.close();
		const saved = savePhoto(db, await edited(db, { ...value, rating: 4 }), 0);
		assert.equal(saved.rating, 4, 'An edit must not reopen an unavailable Original body owner.');
	} finally { await store.close(); db.close(); await rm(directory, { recursive: true, force: false }); }
});

test('Lightscaper native catalog import CAS and hierarchy checks publish nothing on stale or invalid batches', async () => {
	const db = database();
	try {
		create(db, root()); const initial = photo(); publish(db, root().id, 0, await imported(db, [initial]));
		assert.throws(() => publish(db, root().id, 0, {}), /admission/iu);
		assert.throws(() => publish(db, root().id, 0, forgedPacket()), /admission/iu);
		const stale = await imported(db, [photo(2)]); assert.throws(() => publish(db, root().id, 0, stale), { code: 'CATALOG_REVISION_CONFLICT' });
		for (const candidate of [{ ...photo(2), folderId: 'absent' }, { ...photo(2), catalogId: 'foreign' }, { ...photo(2), revision: 1 }]) {
			await assert.rejects(async () => publish(db, root().id, 1, await imported(db, [candidate])));
		}
		await assert.rejects(imported(db, [photo(2), photo(2)]));
		assert.equal(count(db, 'native_photos'), 1); assert.deepEqual({ ...index(db) }, { root_revision: 1, photo_count: 1, index_revision: 1 });
	} finally { db.close(); }
});
function forgedPacket(): unknown { return Object.freeze({ photos: [photo(2)] }); }

test('Lightscaper native catalog rolls back whole document summary memberships and root on actual SQLite publication failure', async () => {
	const db = database();
	try {
		create(db, root());
		db.exec("CREATE TRIGGER refuse_membership BEFORE INSERT ON native_photo_memberships BEGIN SELECT RAISE(ABORT, 'owned membership failure'); END");
		const packet = await imported(db, [photo()]); assert.throws(() => publish(db, root().id, 0, packet), /owned membership failure/u);
		assert.equal(count(db, 'native_photos'), 0); assert.equal(count(db, 'native_photo_memberships'), 0);
		assert.deepEqual({ ...index(db) }, { root_revision: 0, photo_count: 0, index_revision: 0 });
		db.exec('DROP TRIGGER refuse_membership'); assert.equal(publish(db, root().id, 0, packet).photoCount, 1);
	} finally { db.close(); }
});

test('Lightscaper native catalog photo edits keep immutable fields and declared schema with independent index CAS', async () => {
	const db = database();
	try {
		create(db, root()); const value = photo(1, 3); publish(db, root().id, 0, await imported(db, [value]));
		const saved = savePhoto(db, await edited(db, { ...value, rating: 5 }), 0);
		assert.equal(saved.schemaVersion, 3); assert.equal(saved.revision, 1); assert.deepEqual(saved.versions, value.versions);
		assert.deepEqual({ ...index(db) }, { root_revision: 1, photo_count: 1, index_revision: 2 });
		assert.throws(() => savePhoto(db, {} as never, 1), /admission/iu);
		for (const candidate of [{ ...saved, original: { ...saved.original, name: 'Changed' } },
			{ ...saved, schemaVersion: 2 }, { ...saved, extractedMetadata: {} }]) {
			await assert.rejects(async () => savePhoto(db, await edited(db, candidate), 1));
		}
		assert.throws(() => savePhoto(db, forgedPacket(), 0), /admission/iu);
		const stale = await edited(db, value); assert.throws(() => savePhoto(db, stale, 0), { code: 'PHOTO_REVISION_CONFLICT' });
		assert.deepEqual(loadPhoto(db, root().id, value.id), saved);
	} finally { db.close(); }
});

test('Lightscaper native catalog root edits reject count mutation and hierarchy removal still referenced by photos', async () => {
	const db = database();
	try {
		const withFolder = { ...root(), folders: [{ id: 'folder', name: 'Folder', parentId: null }] }; create(db, withFolder);
		const value = { ...photo(), folderId: 'folder' }; const published = publish(db, root().id, 0, await imported(db, [value]));
		assert.throws(() => saveRoot(db, { ...published, photoCount: 0 }, 1));
		assert.throws(() => saveRoot(db, { ...published, folders: [] }, 1), ReferenceError);
		savePhoto(db, await edited(db, { ...value, folderId: null }), 0);
		const saved = saveRoot(db, { ...published, folders: [], name: 'Renamed' }, 1);
		assert.equal(saved.revision, 2); assert.equal(saved.photoCount, 1);
		assert.deepEqual({ ...index(db) }, { root_revision: 2, photo_count: 1, index_revision: 3 });
	} finally { db.close(); }
});

test('Lightscaper native catalog refuses inconsistent inline state before any photo publication', async () => {
	const db = database();
	try {
		create(db, root()); db.prepare('UPDATE native_photo_catalogs SET root_revision = 1 WHERE id = ?').run(root().id);
		assert.throws(() => loadRoot(db, root().id));
		const packet = await imported(db, [photo()]); assert.throws(() => publish(db, root().id, 0, packet));
		assert.equal(count(db, 'native_photos'), 0);
	} finally { db.close(); }
});

test('Lightscaper native catalog derived publication checks actual source revision and Original inside insertion transaction', async () => {
	const db = database();
	try {
		create(db, root()); const sources = [photo(1), photo(2)], result = photo(3);
		const rootAfter = publish(db, root().id, 0, await imported(db, sources));
		const guard = capturePhotoDerivedPublicationGuardCurrentV1(root().id, sources.map(value => ({ photoId: value.id, revision: value.revision, original: value.original })), result.id);
		const packet = await imported(db, [result]); savePhoto(db, await edited(db, { ...sources[0], rating: 2 }), 0);
		assert.throws(() => publishDerived(db, root().id, rootAfter.revision, guard, packet), { code: 'PHOTO_REVISION_CONFLICT' });
		assert.equal(loadPhoto(db, root().id, result.id), null); assert.equal(loadRoot(db, root().id)?.photoCount, 2);
		const fresh = capturePhotoDerivedPublicationGuardCurrentV1(root().id, sources.map(value => ({ photoId: value.id, revision: value.id === sources[0]!.id ? 1 : 0, original: value.original })), result.id);
		assert.equal(publishDerived(db, root().id, 1, fresh, packet).photoCount, 3);
	} finally { db.close(); }
});

test('Lightscaper native catalog admission binds database and purpose and captures candidates before a joined verifier wait', async () => {
	const db = database(), foreign = database(), entered = deferred<void>(), release = deferred<void>(), cancel = new AbortController();
	try {
		create(db, root()); const value = structuredClone(photo()) as unknown as { metadata: { title: string } };
		const expected = normalizePhotoDocumentCurrentV1(value);
		const options = { async verifyOriginal() { entered.resolve(); await release.promise; } };
		const work = admitLightscaperNativeCatalogPhotosCurrentV1(db, [value], 'import', options, cancel.signal);
		await entered.promise; assert.equal(db.isTransaction, false); value.metadata.title = 'Changed while waiting';
		cancel.abort(); assert.equal(await remainsPending(work), true); release.resolve(); await assert.rejects(work, { name: 'AbortError' });
		assert.equal(count(db, 'native_photos'), 0);
		const edit = await edited(db, expected); assert.throws(() => publish(db, root().id, 0, edit), /admission/iu);
		const packet = await imported(db, [expected]); assert.throws(() => publish(foreign, root().id, 0, packet), /admission/iu);
		publish(db, root().id, 0, packet); assert.deepEqual(loadPhoto(db, root().id, expected.id), expected);
	} finally { release.resolve(); db.close(); foreign.close(); }
});

test('Lightscaper native catalog full Current resource closure fails closed for disabled redo-only bodies', async () => {
	const db = database();
	try {
		create(db, root()); const legacy = photo(), master = legacy.versions[0]!;
		const develop = { ...master.develop, processVersion: 2, effects: [{ id: 'disabled-lut', type: 'cube-lut-profile-v1', enabled: false,
			params: { lut: { storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 73,
				size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }] };
		const value = normalizePhotoDocumentCurrentV1({ ...legacy, schemaVersion: 3, versions: [{ ...master,
			workspace: { schemaVersion: 3, kind: 'photo-develop-workspace', cursor: 0, snapshots: [], entries: [
				{ label: 'Original', createdAt: master.createdAt, develop: master.develop },
				{ label: 'Unused redo', createdAt: master.createdAt, develop }] } }] });
		await assert.rejects(imported(db, [value]), /resource/iu);
		await assert.rejects(edited(db, value), /resource/iu); assert.equal(count(db, 'native_photos'), 0);
		let calls = 0;
		const packet = await admitLightscaperNativeCatalogPhotosCurrentV1(db, [value], 'import', { ...ports,
			verifyResources: async complete => { calls++; assert.deepEqual(complete, value); } });
		publish(db, root().id, 0, packet); assert.equal(calls, 1); assert.deepEqual(loadPhoto(db, root().id, value.id), value);
	} finally { db.close(); }
});
