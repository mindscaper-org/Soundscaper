/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { admitLightscaperNativeCatalogPhotosCurrentV1 } from '../desktop/lightscaper-native-catalog-admission-current-v1.ts';
import { createLightscaperNativeCatalogCurrentV1 as create, loadLightscaperNativeCatalogCurrentV1 as load,
	publishLightscaperNativePhotosCurrentV1 as publish, saveLightscaperNativePhotoCurrentV1 as savePhoto,
	saveLightscaperNativeCatalogCurrentV1 as saveRoot } from '../desktop/lightscaper-native-catalog-transactions-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import type { PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const root = () => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
	id: 'catalog-1', name: 'Native', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
const smart = () => normalizePhotoCatalogRootV1({ ...root(), collections: [{ id: 'smart', kind: 'smart', name: 'Stars',
	query: { kind: 'rating', minimum: 1, maximum: 5 } }] });
function database(): DatabaseSync {
	const db = new DatabaseSync(':memory:'); initializeLightscaperNativeCatalogDatabaseCurrentV1(db); return db;
}

test('Lightscaper native catalog provided resource verifier observes every whole resource-free import and edit', { timeout: 10_000 }, async () => {
	const db = database(), entered = deferred<void>(), release = deferred<void>();
	const values = [photoArchiveFixture(1).photo, photoArchiveFixture(2).photo], seen: PhotoDocumentCurrentV1[] = [];
	const ports = { verifyOriginal: async () => undefined,
		async verifyResources(this: unknown, value: PhotoDocumentCurrentV1) {
			assert.equal(this, ports); seen.push(value); entered.resolve(); await release.promise;
		} };
	create(db, root());
	const work = admitLightscaperNativeCatalogPhotosCurrentV1(db, values, 'import', ports);
	try {
		await Promise.race([entered.promise, work.then(() => { throw new Error('Provided resource verifier was skipped for an empty closure.'); })]);
		assert.equal(await remainsPending(work), true); assert.equal(db.isTransaction, false);
		ports.verifyResources = async () => assert.fail('The captured callback was replaced during its borrowed wait.');
		release.resolve(); const packet = await work; assert.deepEqual([...seen], values);
		publish(db, root().id, 0, packet);
		const candidate = normalizePhotoDocumentCurrentV1({ ...values[0]!, rating: 4 });
		const edit = await admitLightscaperNativeCatalogPhotosCurrentV1(db, [candidate], 'edit', {
			verifyResources: async value => { seen.push(value); } });
		savePhoto(db, edit, 0); assert.deepEqual(seen[2], candidate);
	} finally { release.resolve(); await work.catch(() => undefined); db.close(); }
});

test('Lightscaper native catalog creates genuine legacy root smart predicates without manufacturing saved companion state', () => {
	const db = database();
	try {
		create(db, smart()); assert.deepEqual(load(db, root().id), smart());
		assert.equal(db.prepare('SELECT COUNT(*) AS count FROM native_photo_smart_collection_states').get()?.count, 0);
		assert.equal(db.prepare('SELECT COUNT(*) AS count FROM native_photo_smart_collections').get()?.count, 0);
	} finally { db.close(); }
});

test('Lightscaper native catalog root edits admit legacy smart predicates with an authenticated empty saved inventory', () => {
	const db = database();
	try {
		create(db, root()); const next = saveRoot(db, smart(), 0);
		assert.deepEqual(next.collections, smart().collections); assert.equal(next.revision, 1);
		assert.equal(db.prepare('SELECT index_revision FROM native_photo_catalogs').get()?.index_revision, 1);
		assert.equal(db.prepare('SELECT COUNT(*) AS count FROM native_photo_smart_collection_states').get()?.count, 0);
	} finally { db.close(); }
});

test('Lightscaper native catalog edits or removes unreferenced legacy smart predicates without changing saved state', () => {
	const stored = smart();
	for (const candidate of [root(), { ...stored, name: 'Renamed' }, { ...stored, collections: stored.collections.map(value => ({ ...value, name: 'Changed' })) }]) {
		const db = database();
		try {
			create(db, stored); const next = saveRoot(db, candidate, 0);
			assert.equal(next.revision, 1); assert.deepEqual(next.collections, candidate.collections);
			assert.equal(db.prepare('SELECT COUNT(*) AS count FROM native_photo_smart_collection_states').get()?.count, 0);
		} finally { db.close(); }
	}
});

test('Lightscaper native catalog root save retains a real SQL refusal and an independent rollback failure', () => {
	const db = database(), nativeExec = DatabaseSync.prototype.exec, cleanup = new Error('Root rollback cleanup failed.');
	create(db, root()); db.exec("CREATE TRIGGER refuse_root BEFORE UPDATE ON native_photo_catalogs BEGIN SELECT RAISE(ABORT, 'Root publication refused.'); END");
	DatabaseSync.prototype.exec = function (sql: string): void {
		if (this === db && sql === 'ROLLBACK') throw cleanup;
		nativeExec.call(this, sql);
	};
	try {
		assert.throws(() => saveRoot(db, { ...root(), name: 'Renamed' }, 0), (error: unknown) => {
			assert.ok(error instanceof AggregateError); assert.equal(error.errors.length, 2);
			assert.match(String(error.errors[0]), /Root publication refused/u); assert.equal(error.errors[1], cleanup); return true;
		});
	} finally {
		DatabaseSync.prototype.exec = nativeExec;
		if (db.isTransaction) db.exec('ROLLBACK');
		assert.deepEqual(load(db, root().id), root()); db.close();
	}
});
