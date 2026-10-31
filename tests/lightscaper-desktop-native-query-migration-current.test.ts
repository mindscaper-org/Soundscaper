/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { getLightscaperNativeQueryBuildCurrentV1 } from '../desktop/lightscaper-native-query-write-current-v1.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, upgradePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { upgradePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';
import { initializeLightscaperNativeCatalogV1FixtureCurrent, LIGHTSCAPER_NATIVE_CATALOG_V1_SCHEMA_FIXTURE_CURRENT } from './helpers/lightscaper-native-catalog-v1-schema-fixture-current.ts';

const makeDatabase = () => new DatabaseSync(':memory:', { allowExtension: false, enableDoubleQuotedStringLiterals: false });
const objects = (database: DatabaseSync) => database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
const version = (database: DatabaseSync) => database.prepare('PRAGMA user_version').get()?.user_version;
function seedHistorical(database: DatabaseSync): void {
	const root = nativeCatalogRootCurrentV1();
	database.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(root.id, serializeLightscaperDocumentV1({ ...root, photoCount: 3 }), 0, 3, 9);
	const photo = nativePhotoCurrentV1();
	for (const [index, value] of [photo, upgradePhotoDocumentV2(photo), upgradePhotoDocumentCurrentV1(photo)].entries()) {
		const current = normalizePhotoDocumentCurrentV1({ ...value, id: `photo-${String(index)}` });
		database.prepare('INSERT INTO native_photos VALUES (?,?,?,?,?,?)').run(photoStorageKey(current.catalogId, current.id), current.catalogId,
			current.id, current.revision, serializePhotoDocumentCurrentV1(current), JSON.stringify(photoSummary(current)));
	}
	database.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run('empty', serializeLightscaperDocumentV1({ ...root, id: 'empty' }), 0, 0, 0);
}

test('Lightscaper native Query2 migrates exact historical v1 on disk without reading or rewriting any Photo aggregates', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-query-migration-')); let database: DatabaseSync | undefined;
	try {
		const path = join(directory, 'catalog.sqlite3'); database = new DatabaseSync(path);
		initializeLightscaperNativeCatalogV1FixtureCurrent(database); seedHistorical(database);
		const roots = database.prepare('SELECT * FROM native_photo_catalogs ORDER BY id').all();
		const photos = database.prepare('SELECT * FROM native_photos ORDER BY photo_key').all();
		database.close(); database = new DatabaseSync(path); let aggregateReads = 0;
		database.setAuthorizer((action, table, column) => {
			if (action === constants.SQLITE_READ && ['native_photos', 'native_photo_catalogs'].includes(table ?? '') && column === 'document') {
				aggregateReads += 1; return constants.SQLITE_DENY;
			}
			return constants.SQLITE_OK;
		});
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.setAuthorizer(null);
		assert.equal(aggregateReads, 0); assert.equal(version(database), 5); assert.equal(database.isTransaction, false);
		assert.deepEqual(database.prepare('SELECT * FROM native_photo_catalogs ORDER BY id').all(), roots);
		assert.deepEqual(database.prepare('SELECT * FROM native_photos ORDER BY photo_key').all(), photos);
		for (const id of ['catalog', 'empty']) assert.deepEqual(getLightscaperNativeQueryBuildCurrentV1(database, id), {
			id, schemaVersion: 2, ready: false, afterKey: null, indexedCount: 0 });
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photo_query_rows_v2').get()?.count, 0);
		database.close(); database = new DatabaseSync(path); initializeLightscaperNativeCatalogDatabaseCurrentV1(database);
		assert.deepEqual(database.prepare('SELECT * FROM native_photos ORDER BY photo_key').all(), photos);
		assert.deepEqual(getLightscaperNativeQueryBuildCurrentV1(database, 'catalog'), { id: 'catalog', schemaVersion: 2, ready: false, afterKey: null, indexedCount: 0 });
	} finally { if (database?.isOpen) { database.setAuthorizer(null); database.close(); } await rm(directory, { recursive: true, force: false }); }
});

test('Lightscaper native Query2 verifies every old schema byte before permitting migration', () => {
	for (const mutate of ['DROP INDEX native_photo_memberships_scope_key', 'CREATE INDEX foreign_index ON native_photos(photo_id)',
		'CREATE TABLE foreign_data(value TEXT)', 'CREATE TRIGGER foreign_trigger AFTER INSERT ON native_photos BEGIN SELECT 1; END']) {
		const database = makeDatabase();
		try {
			initializeLightscaperNativeCatalogV1FixtureCurrent(database); seedHistorical(database); database.exec(mutate);
			const before = objects(database), rows = database.prepare('SELECT * FROM native_photos').all();
			assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database));
			assert.equal(version(database), 1); assert.equal(database.isTransaction, false); assert.deepEqual(objects(database), before);
			assert.deepEqual(database.prepare('SELECT * FROM native_photos').all(), rows);
		} finally { database.close(); }
	}
	const database = makeDatabase();
	try {
		for (const entry of LIGHTSCAPER_NATIVE_CATALOG_V1_SCHEMA_FIXTURE_CURRENT) database.exec(entry.sql.replace('photo_count BETWEEN 0 AND 10000000', 'photo_count BETWEEN 0 AND 9999999'));
		database.exec('PRAGMA application_id=1280525123; PRAGMA user_version=1'); const before = objects(database);
		assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database)); assert.equal(version(database), 1); assert.deepEqual(objects(database), before);
	} finally { database.close(); }
});

test('Lightscaper native Query2 rolls back all new tables, indexes, build state and schema version when migration fails late', () => {
	const database = makeDatabase();
	try {
		initializeLightscaperNativeCatalogV1FixtureCurrent(database); seedHistorical(database);
		const before = objects(database), roots = database.prepare('SELECT * FROM native_photo_catalogs').all(); let denied = 0;
		database.setAuthorizer((action, name) => {
			if (action === constants.SQLITE_CREATE_INDEX && name === 'native_photo_query_v2_rating') { denied += 1; return constants.SQLITE_DENY; }
			return constants.SQLITE_OK;
		});
		assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database)); database.setAuthorizer(null);
		assert.equal(denied, 1); assert.equal(database.isTransaction, false); assert.equal(version(database), 1);
		assert.deepEqual(objects(database), before); assert.deepEqual(database.prepare('SELECT * FROM native_photo_catalogs').all(), roots);
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); assert.equal(version(database), 5);
	} finally { database.setAuthorizer(null); database.close(); }
});

test('Lightscaper native Query2 fresh schema authenticates every new index and refuses partial or extra v2 objects', () => {
	const database = makeDatabase();
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); assert.equal(version(database), 5);
		assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name GLOB 'native_photo_query_v2_*' ORDER BY name").all().map(row => row.name),
			['native_photo_query_v2_capture_time', 'native_photo_query_v2_file_name', 'native_photo_query_v2_photo_id', 'native_photo_query_v2_rating']);
		for (const name of ['native_photo_query_rows_v2', 'native_photo_query_builds_v2']) assert.equal(database.prepare('SELECT strict FROM pragma_table_list WHERE name=?').get(name)?.strict, 1);
		database.exec('DROP INDEX native_photo_query_v2_file_name'); const before = objects(database);
		assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database)); assert.deepEqual(objects(database), before); assert.equal(version(database), 5);
	} finally { database.close(); }
});
