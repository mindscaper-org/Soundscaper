/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 as initialize } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { admitLightscaperNativeCatalogPhotosCurrentV1 as admit } from '../desktop/lightscaper-native-catalog-admission-current-v1.ts';
import { createLightscaperNativeCatalogCurrentV1 as create, loadLightscaperNativePhotoCurrentV1 as loadPhoto,
	publishLightscaperNativePhotosCurrentV1 as publish, publishDerivedLightscaperNativePhotoCurrentV1 as derived,
	saveLightscaperNativePhotoCurrentV1 as edit, saveLightscaperNativeCatalogCurrentV1 as saveRoot,
	loadLightscaperNativeCatalogCurrentV1 as loadRoot } from '../desktop/lightscaper-native-catalog-transactions-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { capturePhotoDerivedPublicationGuardCurrentV1 } from '../src/lightscaper/catalog/photo-derived-publication-current-v1.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';

const TABLES = ['native_photo_catalogs', 'native_photos', 'native_photo_memberships', 'native_photo_query_rows_v1',
	'native_photo_query_builds_v1', 'native_photo_query_rows_v2', 'native_photo_query_builds_v2', 'native_photo_stack_states'];
const members = (prefix: string) => Array.from({ length: 1_024 }, (_, index) => `${prefix}${String(index).padStart(4, '0')}${'x'.repeat(123)}`);
function root(rich = false) {
	const base = nativeCatalogRootCurrentV1();
	return normalizePhotoCatalogRootV1({ ...base,
		keywords: rich ? members('k').map(id => ({ id, name: 'Keyword', parentId: null })) : base.keywords,
		collections: rich ? members('c').map(id => ({ id, name: 'Manual', kind: 'manual' })) : base.collections.filter(value => value.kind === 'manual') });
}
function richPhoto() {
	const base = nativePhotoCurrentV1(), words = '\ud800'.repeat(16_384);
	return normalizePhotoDocumentCurrentV1({ ...base, keywordIds: members('k'), collectionIds: members('c'),
		metadata: { ...base.metadata, title: words, caption: words, creator: words, copyright: words, location: words } });
}
const smallPhoto = (photo: PhotoDocumentCurrentV1) => normalizePhotoDocumentCurrentV1({ ...photo,
	metadata: { ...photo.metadata, title: '', caption: '', creator: '', copyright: '', location: '' } });
const imported = (database: DatabaseSync, photos: readonly PhotoDocumentCurrentV1[]) => admit(database, photos, 'import', { verifyOriginal: async () => undefined });
const edited = (database: DatabaseSync, photo: PhotoDocumentCurrentV1) => admit(database, [photo], 'edit', {});
const snapshot = (database: DatabaseSync) => TABLES.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
function build(database: DatabaseSync) {
	const value = database.prepare('SELECT ready,after_key,indexed_count FROM native_photo_query_builds_v1 WHERE catalog_id=?').get('catalog');
	assert.ok(value); return { ...value };
}
function row(database: DatabaseSync, photo: PhotoDocumentCurrentV1, version: 1 | 2): unknown {
	const value = database.prepare(`SELECT row_json FROM native_photo_query_rows_v${String(version)} WHERE photo_key=?`).get(photoStorageKey(photo.catalogId, photo.id));
	return value === undefined ? undefined : JSON.parse(value.row_json as string) as unknown;
}
async function fixture(run: (database: DatabaseSync, path: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper legacy publication '))), path = join(directory, 'catalog.sqlite3');
	const database = new DatabaseSync(path);
	try { initialize(database); await run(database, path); } finally { database.close(); }
	await rm(directory, { recursive: true, force: false });
}

test('Lightscaper native creator and every Current import/edit publish exact independent Query1 and Query2 rows through reopen', async () => {
	await fixture(async (database, path) => {
		create(database, root()); assert.deepEqual(build(database), { ready: 1, after_key: null, indexed_count: 0 });
		const photos = [1, 2, 3].map(schemaVersion => normalizePhotoDocumentCurrentV1({ ...nativePhotoCurrentV1(schemaVersion), schemaVersion }));
		publish(database, 'catalog', 0, await imported(database, photos));
		for (const photo of photos) {
			assert.deepEqual(row(database, photo, 1), projectPhotoQueryRowV1(photo));
			assert.deepEqual(row(database, photo, 2), projectPhotoQueryRowV2(photo));
		}
		const saved = edit(database, await edited(database, { ...photos[0]!, rating: 5 }), 0);
		assert.deepEqual(build(database), { ready: 1, after_key: null, indexed_count: 3 });
		const reopened = new DatabaseSync(path);
		try {
			initialize(reopened); assert.deepEqual(loadPhoto(reopened, 'catalog', saved.id), saved);
			assert.deepEqual(row(reopened, saved, 1), projectPhotoQueryRowV1(saved));
			assert.deepEqual(row(reopened, saved, 2), projectPhotoQueryRowV2(saved));
		} finally { reopened.close(); }
	});
});

test('Lightscaper native derived publication projects both profiles and a stale selected source publishes neither', async () => {
	await fixture(async database => {
		create(database, root()); const source = nativePhotoCurrentV1(), other = nativePhotoCurrentV1(1);
		publish(database, 'catalog', 0, await imported(database, [source, other]));
		const selections = [source, other].map(photo => ({ photoId: photo.id, revision: photo.revision, original: photo.original }));
		const result = normalizePhotoDocumentCurrentV1({ ...source, id: 'derived-output' });
		const guard = capturePhotoDerivedPublicationGuardCurrentV1('catalog', selections, result.id);
		derived(database, 'catalog', 1, guard, await imported(database, [result]));
		assert.deepEqual(row(database, result, 1), projectPhotoQueryRowV1(result));
		assert.deepEqual(row(database, result, 2), projectPhotoQueryRowV2(result));
		edit(database, await edited(database, { ...source, rating: 5 }), 0);
		const second = normalizePhotoDocumentCurrentV1({ ...source, id: 'another-output' });
		const stale = capturePhotoDerivedPublicationGuardCurrentV1('catalog', selections, second.id), before = snapshot(database);
		const packet = await imported(database, [second]);
		assert.throws(() => derived(database, 'catalog', 2, stale, packet), { code: 'PHOTO_REVISION_CONFLICT' });
		assert.deepEqual(snapshot(database), before);
	});
});

test('Lightscaper native legal Row1 overflow imports full Current and Query2 and retires only the legacy build', async () => {
	await fixture(async database => {
		create(database, root(true)); const photo = richPhoto();
		assert.throws(() => projectPhotoQueryRowV1(photo), /Photo query row exceeds its byte budget/u);
		publish(database, 'catalog', 0, await imported(database, [photo]));
		assert.deepEqual(loadPhoto(database, 'catalog', photo.id), photo);
		assert.deepEqual(row(database, photo, 2), projectPhotoQueryRowV2(photo));
		assert.equal(row(database, photo, 1), undefined);
		assert.deepEqual(build(database), { ready: 0, after_key: null, indexed_count: 0 });
		const saved = edit(database, await edited(database, smallPhoto(photo)), 0);
		assert.deepEqual(row(database, saved, 1), projectPhotoQueryRowV1(saved));
		assert.deepEqual(build(database), { ready: 0, after_key: null, indexed_count: 1 });
	});
});

test('Lightscaper native overflow edit retains prior Row1/count and resets its cursor; downstream SQL refusal rolls everything back', async () => {
	await fixture(async database => {
		create(database, root(true)); const rich = richPhoto(), small = smallPhoto(rich);
		publish(database, 'catalog', 0, await imported(database, [small])); const retained = row(database, small, 1);
		database.prepare('UPDATE native_photo_query_builds_v1 SET ready=0,after_key=?').run(photoStorageKey('catalog', small.id));
		const packet = await edited(database, rich), before = snapshot(database);
		database.exec("CREATE TRIGGER refuse_legacy_overflow AFTER UPDATE ON native_photo_query_rows_v2 BEGIN SELECT RAISE(ABORT,'downstream refusal'); END");
		assert.throws(() => edit(database, packet, 0), /downstream refusal/u); assert.deepEqual(snapshot(database), before);
		database.exec('DROP TRIGGER refuse_legacy_overflow');
		const saved = edit(database, await edited(database, rich), 0);
		assert.deepEqual(row(database, saved, 1), retained);
		assert.deepEqual(row(database, saved, 2), projectPhotoQueryRowV2(saved));
		assert.deepEqual(build(database), { ready: 0, after_key: null, indexed_count: 1 });
		const shrunk = edit(database, await edited(database, smallPhoto(saved)), 1);
		assert.deepEqual(row(database, shrunk, 1), projectPhotoQueryRowV1(shrunk));
		assert.deepEqual(build(database), { ready: 0, after_key: null, indexed_count: 1 });
	});
});

test('Lightscaper native Query1 SQL failures are transaction failures even when their message matches the projection budget', async () => {
	await fixture(async database => {
		create(database, root()); const photo = nativePhotoCurrentV1(), packet = await imported(database, [photo]), before = snapshot(database);
		database.exec("CREATE TRIGGER refuse_legacy BEFORE INSERT ON native_photo_query_rows_v1 BEGIN SELECT RAISE(ABORT,'Photo query row exceeds its byte budget.'); END");
		assert.throws(() => publish(database, 'catalog', 0, packet), /Photo query row exceeds its byte budget/u);
		assert.deepEqual(snapshot(database), before); database.exec('DROP TRIGGER refuse_legacy');
		publish(database, 'catalog', 0, await imported(database, [photo]));
		for (const table of ['native_photo_query_rows_v1', 'native_photo_query_rows_v2']) {
			const prior = snapshot(database), change = await edited(database, { ...photo, rating: 5 });
			database.exec(`CREATE TRIGGER refuse_legacy BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'owned row refusal'); END`);
			assert.throws(() => edit(database, change, 0), /owned row refusal/u);
			assert.deepEqual(snapshot(database), prior); database.exec('DROP TRIGGER refuse_legacy');
		}
	});
});

test('Lightscaper native all mutation paths refuse missing or incoherent owned Query1 builds without repairing them', async () => {
	await fixture(async database => {
		create(database, root()); const photo = nativePhotoCurrentV1(), extra = nativePhotoCurrentV1(1);
		publish(database, 'catalog', 0, await imported(database, [photo])); const catalog = loadRoot(database, 'catalog')!;
		for (const fault of ['count', 'missing'] as const) {
			if (fault === 'count') database.exec('UPDATE native_photo_query_builds_v1 SET indexed_count=2');
			else database.exec('DELETE FROM native_photo_query_builds_v1');
			const before = snapshot(database), change = await edited(database, { ...photo, rating: 5 }), addition = await imported(database, [extra]);
			assert.throws(() => edit(database, change, 0), /query|build/iu); assert.deepEqual(snapshot(database), before);
			assert.throws(() => publish(database, 'catalog', 1, addition), /query|build/iu); assert.deepEqual(snapshot(database), before);
			assert.throws(() => saveRoot(database, { ...catalog, name: 'Refused' }, 1), /query|build/iu); assert.deepEqual(snapshot(database), before);
		}
	});
});
