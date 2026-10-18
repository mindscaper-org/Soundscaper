/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1 } from '../desktop/lightscaper-native-query-records-current-v1.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { serializePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';
import { initializeLightscaperNativeCatalogV1FixtureCurrent } from './helpers/lightscaper-native-catalog-v1-schema-fixture-current.ts';
import { initializeLightscaperNativeCatalogV2FixtureCurrent, LIGHTSCAPER_NATIVE_CATALOG_V2_SCHEMA_FIXTURE_CURRENT } from './helpers/lightscaper-native-catalog-v2-schema-fixture-current.ts';

const makeDatabase = () => new DatabaseSync(':memory:', { allowExtension: false, enableDoubleQuotedStringLiterals: false });
const objects = (database: DatabaseSync) => database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
const version = (database: DatabaseSync) => database.prepare('PRAGMA user_version').get()?.user_version;
const rootRows = (database: DatabaseSync) => database.prepare('SELECT * FROM native_photo_catalogs ORDER BY id').all();
const photoRows = (database: DatabaseSync) => database.prepare('SELECT * FROM native_photos ORDER BY photo_key').all();
function seed(database: DatabaseSync, withQuery: boolean): void {
	const root = nativeCatalogRootCurrentV1();
	database.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(root.id, serializeLightscaperDocumentV1({ ...root, photoCount: 2 }), 0, 2, 9);
	database.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run('empty', serializeLightscaperDocumentV1({ ...root, id: 'empty' }), 0, 0, 0);
	for (const photo of [nativePhotoCurrentV1(), nativePhotoCurrentV1(1)]) database.prepare('INSERT INTO native_photos VALUES (?,?,?,?,?,?)')
		.run(photoStorageKey(photo.catalogId, photo.id), photo.catalogId, photo.id, photo.revision, serializePhotoDocumentCurrentV1(photo), JSON.stringify(photoSummary(photo)));
	if (withQuery) {
		const row = projectPhotoQueryRowV2(nativePhotoCurrentV1());
		database.prepare('INSERT INTO native_photo_query_rows_v2 VALUES (?,?,?,?,?,?,?,?,?)').run(row.key, row.catalogId, row.photoId, row.photoRevision,
			JSON.stringify(row), lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort), row.captureBucket, row.captureSort, row.ratingSort);
		database.prepare('INSERT INTO native_photo_query_builds_v2 VALUES (?,?,?,?)').run('catalog', 0, row.key, 1);
		database.prepare('INSERT INTO native_photo_query_builds_v2 VALUES (?,?,?,?)').run('empty', 1, null, 0);
	}
}
function assertZeroStates(database: DatabaseSync): void {
	assert.deepEqual(database.prepare('SELECT catalog_id,revision,stack_count FROM native_photo_stack_states ORDER BY catalog_id').all().map(row => ({ ...row })), [
		{ catalog_id: 'catalog', revision: 0, stack_count: 0 }, { catalog_id: 'empty', revision: 0, stack_count: 0 }]);
	for (const table of ['native_photo_stacks', 'native_photo_stack_forward_members', 'native_photo_stack_memberships']) {
		assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0);
	}
}

test('Lightscaper native stacks migrate exact historical v2 on disk with all catalog, Photo, Query2 rows and partial cursor bytes intact', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-stack-migration-')); let database: DatabaseSync | undefined;
	try {
		const path = join(directory, 'catalog.sqlite3'); database = new DatabaseSync(path); initializeLightscaperNativeCatalogV2FixtureCurrent(database); seed(database, true);
		const roots = rootRows(database), photos = photoRows(database), query = database.prepare('SELECT * FROM native_photo_query_rows_v2').all();
		const builds = database.prepare('SELECT * FROM native_photo_query_builds_v2 ORDER BY catalog_id').all(); database.close(); database = new DatabaseSync(path);
		let aggregateReads = 0;
		database.setAuthorizer((action, table, column) => {
			if (action === constants.SQLITE_READ && (column === 'document' && ['native_photos', 'native_photo_catalogs'].includes(table ?? '')
				|| table === 'native_photo_query_rows_v2' && column === 'row_json')) { aggregateReads += 1; return constants.SQLITE_DENY; }
			return constants.SQLITE_OK;
		});
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.setAuthorizer(null);
		assert.equal(version(database), 4); assert.equal(aggregateReads, 0); assert.equal(database.isTransaction, false);
		assert.deepEqual(rootRows(database), roots); assert.deepEqual(photoRows(database), photos);
		assert.deepEqual(database.prepare('SELECT * FROM native_photo_query_rows_v2').all(), query);
		assert.deepEqual(database.prepare('SELECT * FROM native_photo_query_builds_v2 ORDER BY catalog_id').all(), builds); assertZeroStates(database);
		database.close(); database = new DatabaseSync(path); initializeLightscaperNativeCatalogDatabaseCurrentV1(database);
		assert.equal(version(database), 4); assert.deepEqual(rootRows(database), roots); assertZeroStates(database);
	} finally { if (database?.isOpen) { database.setAuthorizer(null); database.close(); } await rm(directory, { recursive: true, force: false }); }
});

test('Lightscaper native stacks migrate exact historical v1 directly to v4 while retaining the unready Query2 migration', () => {
	const database = makeDatabase();
	try {
		initializeLightscaperNativeCatalogV1FixtureCurrent(database); seed(database, false); const roots = rootRows(database), photos = photoRows(database);
		database.setAuthorizer((action, table, column) => action === constants.SQLITE_READ && column === 'document'
			&& ['native_photos', 'native_photo_catalogs'].includes(table ?? '') ? constants.SQLITE_DENY : constants.SQLITE_OK);
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.setAuthorizer(null);
		assert.equal(version(database), 4); assert.deepEqual(rootRows(database), roots); assert.deepEqual(photoRows(database), photos); assertZeroStates(database);
		assert.deepEqual(database.prepare('SELECT * FROM native_photo_query_builds_v2 ORDER BY catalog_id').all().map(row => ({ ...row })), [
			{ catalog_id: 'catalog', ready: 0, after_key: null, indexed_count: 0 }, { catalog_id: 'empty', ready: 0, after_key: null, indexed_count: 0 }]);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photo_query_rows_v2').get()?.count, 0);
	} finally { database.setAuthorizer(null); database.close(); }
});

test('Lightscaper native stacks refuse every altered historical v2 schema before adding any stack table or state', () => {
	for (const mutate of ['DROP INDEX native_photo_query_v2_file_name', 'CREATE TABLE foreign_payload(value TEXT)',
		'CREATE TRIGGER foreign_trigger AFTER INSERT ON native_photos BEGIN SELECT 1; END']) {
		const database = makeDatabase();
		try {
			initializeLightscaperNativeCatalogV2FixtureCurrent(database); seed(database, true); database.exec(mutate);
			const before = objects(database), roots = rootRows(database), photos = photoRows(database);
			assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database)); assert.equal(version(database), 2);
			assert.deepEqual(objects(database), before); assert.deepEqual(rootRows(database), roots); assert.deepEqual(photoRows(database), photos); assert.equal(database.isTransaction, false);
		} finally { database.close(); }
	}
	const database = makeDatabase();
	try {
		for (const entry of LIGHTSCAPER_NATIVE_CATALOG_V2_SCHEMA_FIXTURE_CURRENT) database.exec(entry.sql.replace('rating_sort BETWEEN 0 AND 5', 'rating_sort BETWEEN 0 AND 4'));
		database.exec('PRAGMA application_id=1280525123; PRAGMA user_version=2'); const before = objects(database);
		assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database)); assert.equal(version(database), 2); assert.deepEqual(objects(database), before);
	} finally { database.close(); }
});

test('Lightscaper native stacks roll back the whole v2-to-v4 migration if the final forward trigger cannot be created', () => {
	const database = makeDatabase();
	try {
		initializeLightscaperNativeCatalogV2FixtureCurrent(database); seed(database, true); const before = objects(database), photos = photoRows(database); let denied = 0;
		database.setAuthorizer((action, name) => {
			if (action === constants.SQLITE_CREATE_TRIGGER && name === 'native_photo_stacks_forward_update') { denied += 1; return constants.SQLITE_DENY; }
			return constants.SQLITE_OK;
		});
		assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database)); database.setAuthorizer(null);
		assert.equal(denied, 1); assert.equal(version(database), 2); assert.equal(database.isTransaction, false); assert.deepEqual(objects(database), before); assert.deepEqual(photoRows(database), photos);
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); assert.equal(version(database), 4); assertZeroStates(database);
	} finally { database.setAuthorizer(null); database.close(); }
});

test('Lightscaper native stacks authenticate exact owned trigger bytes on every v4 reopen', () => {
	const database = makeDatabase();
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); assert.equal(version(database), 4);
		assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name").all().map(row => row.name),
			['native_photo_stacks_forward_insert', 'native_photo_stacks_forward_update']);
		database.exec('DROP TRIGGER native_photo_stacks_forward_update; CREATE TRIGGER native_photo_stacks_forward_update AFTER UPDATE ON native_photo_stacks BEGIN SELECT 1; END');
		const before = objects(database); assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database)); assert.deepEqual(objects(database), before); assert.equal(version(database), 4);
	} finally { database.close(); }
});
