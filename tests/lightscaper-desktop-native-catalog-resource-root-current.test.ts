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
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
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

test('Lightscaper native catalog creation refuses unsupported smart companion definitions before writing', () => {
	const db = database();
	try {
		assert.throws(() => create(db, smart()), /smart|companion|unsupported/iu);
		assert.equal(load(db, root().id), null);
		assert.equal(db.prepare('SELECT COUNT(*) AS count FROM native_photo_catalogs').get()?.count, 0);
	} finally { db.close(); }
});

test('Lightscaper native catalog root edits refuse new smart companion definitions without changing state', () => {
	const db = database();
	try {
		create(db, root()); const before = db.prepare('SELECT * FROM native_photo_catalogs').get();
		assert.throws(() => saveRoot(db, smart(), 0), /smart|companion|unsupported/iu);
		assert.deepEqual(db.prepare('SELECT * FROM native_photo_catalogs').get(), before);
	} finally { db.close(); }
});

test('Lightscaper native catalog refuses changing or removing existing unsupported smart definitions', () => {
	const db = database();
	try {
		// An actual otherwise valid native row can arrive from an unsupported
		// writer. This first schema cannot silently treat missing companions as empty.
		const stored = smart();
		db.prepare('INSERT INTO native_photo_catalogs (id, document, root_revision, photo_count, index_revision) VALUES (?, ?, 0, 0, 0)')
			.run(stored.id, serializeLightscaperDocumentV1(stored));
		db.prepare('INSERT INTO native_photo_query_builds_v2 VALUES (?,1,NULL,0)').run(stored.id);
		db.prepare('INSERT INTO native_photo_query_builds_v1 VALUES (?,1,NULL,0)').run(stored.id);
		const before = db.prepare('SELECT * FROM native_photo_catalogs').get();
		for (const candidate of [root(), { ...stored, name: 'Renamed' }, { ...stored, collections: stored.collections.map(value => ({ ...value, name: 'Changed' })) }]) {
			assert.throws(() => saveRoot(db, candidate, 0), /smart|companion|unsupported/iu);
			assert.deepEqual(db.prepare('SELECT * FROM native_photo_catalogs').get(), before);
		}
	} finally { db.close(); }
});
