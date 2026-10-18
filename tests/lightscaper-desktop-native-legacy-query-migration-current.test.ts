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
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, upgradePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { upgradePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { serializePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';
import { initializeLightscaperNativeCatalogV1FixtureCurrent } from './helpers/lightscaper-native-catalog-v1-schema-fixture-current.ts';
import { initializeLightscaperNativeCatalogV2FixtureCurrent } from './helpers/lightscaper-native-catalog-v2-schema-fixture-current.ts';
import { initializeLightscaperNativeCatalogV3FixtureCurrent, LIGHTSCAPER_NATIVE_CATALOG_V3_SCHEMA_FIXTURE_CURRENT } from './helpers/lightscaper-native-catalog-v3-schema-fixture-current.ts';

const makeDatabase = () => new DatabaseSync(':memory:', { allowExtension: false, enableDoubleQuotedStringLiterals: false });
const objects = (database: DatabaseSync) => database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
const version = (database: DatabaseSync) => database.prepare('PRAGMA user_version').get()?.user_version;
const historicalTables = ['native_photo_catalogs', 'native_photos', 'native_photo_memberships', 'native_photo_query_rows_v2',
	'native_photo_query_builds_v2', 'native_photo_stacks', 'native_photo_stack_states', 'native_photo_stack_forward_members', 'native_photo_stack_memberships'];
function snapshot(database: DatabaseSync, tables: readonly string[]) {
	return tables.map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() }));
}
function seed(database: DatabaseSync, historicalVersion: number): void {
	const root = nativeCatalogRootCurrentV1(), photo = nativePhotoCurrentV1();
	database.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(root.id, serializeLightscaperDocumentV1({ ...root, photoCount: 3 }), 0, 3, 9);
	database.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run('empty', serializeLightscaperDocumentV1({ ...root, id: 'empty' }), 0, 0, 0);
	for (const [index, value] of [photo, upgradePhotoDocumentV2(photo), upgradePhotoDocumentCurrentV1(photo)].entries()) {
		const current = normalizePhotoDocumentCurrentV1({ ...value, id: `photo-${String(index)}` });
		database.prepare('INSERT INTO native_photos VALUES (?,?,?,?,?,?)').run(photoStorageKey(current.catalogId, current.id), current.catalogId,
			current.id, current.revision, serializePhotoDocumentCurrentV1(current), JSON.stringify(photoSummary(current)));
		if (index === 0 && historicalVersion >= 2) {
			const row = projectPhotoQueryRowV2(current);
			database.prepare('INSERT INTO native_photo_query_rows_v2 VALUES (?,?,?,?,?,?,?,?,?)').run(row.key, row.catalogId, row.photoId, row.photoRevision,
				JSON.stringify(row), lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort), row.captureBucket, row.captureSort, row.ratingSort);
		}
	}
	database.prepare('INSERT INTO native_photo_memberships VALUES (?,?,?,?)').run('catalog|collection|manual|photo-0', 'catalog|collection|manual', 'catalog|photo-0', 'catalog');
	if (historicalVersion >= 2) {
		database.prepare('INSERT INTO native_photo_query_builds_v2 VALUES (?,?,?,?)').run('catalog', 0, 'catalog|photo-0', 1);
		database.prepare('INSERT INTO native_photo_query_builds_v2 VALUES (?,?,?,?)').run('empty', 1, null, 0);
	}
	if (historicalVersion >= 3) {
		const document = serializePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog', id: 'group', revision: 7,
			photoIds: ['photo-1', 'photo-0'], coverPhotoId: 'photo-0' });
		database.prepare('INSERT INTO native_photo_stacks VALUES (?,?,?,?,?,?,?)').run('catalog|group', 'catalog', 'group', 7, document, 2, 'photo-0');
		for (const [position, id] of ['photo-1', 'photo-0'].entries()) database.prepare('INSERT INTO native_photo_stack_memberships VALUES (?,?,?,?,?,?)')
			.run(`catalog|${id}`, 'catalog', id, 'catalog|group', 'group', position);
		database.prepare('INSERT INTO native_photo_stack_states VALUES (?,?,?)').run('catalog', 11, 1);
		database.prepare('INSERT INTO native_photo_stack_states VALUES (?,?,?)').run('empty', 5, 0);
	}
}
function assertUnreadyLegacy(database: DatabaseSync): void {
	assert.deepEqual(database.prepare('SELECT * FROM native_photo_query_builds_v1 ORDER BY catalog_id').all().map(row => ({ ...row })), [
		{ catalog_id: 'catalog', ready: 0, after_key: null, indexed_count: 0 }, { catalog_id: 'empty', ready: 0, after_key: null, indexed_count: 0 }]);
	assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photo_query_rows_v1').get()?.count, 0);
}
function forbidAggregateReads(database: DatabaseSync, onDenied: () => void): void {
	// SQLite authorizes columns mentioned by a new table's CHECK while creating
	// its DDL. Such absent tables have no persisted aggregates to read. Keep
	// unconditional Photo/root denial and guard only pre-existing stack/Query2.
	const existing = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
	database.setAuthorizer((action, table, column) => {
		if (action === constants.SQLITE_READ && (column === 'document' && (['native_photos', 'native_photo_catalogs'].includes(table ?? '')
			|| table === 'native_photo_stacks' && existing.has(table))
			|| table === 'native_photo_query_rows_v2' && column === 'row_json' && existing.has(table))) { onDenied(); return constants.SQLITE_DENY; }
		return constants.SQLITE_OK;
	});
}

test('Lightscaper native Legacy Query1 migrates independent historical v3 on disk preserving all Query2, stack, Current1/2/3 and partial cursor bytes', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-legacy-migration-')); let database: DatabaseSync | undefined;
	try {
		const path = join(directory, 'catalog.sqlite3'); database = new DatabaseSync(path);
		initializeLightscaperNativeCatalogV3FixtureCurrent(database); seed(database, 3); const before = snapshot(database, historicalTables);
		assert.equal(objects(database).length, 20); database.close(); database = new DatabaseSync(path); let aggregateReads = 0;
		forbidAggregateReads(database, () => { aggregateReads += 1; });
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.setAuthorizer(null);
		assert.equal(version(database), 4); assert.equal(aggregateReads, 0); assert.equal(database.isTransaction, false);
		assert.deepEqual(snapshot(database, historicalTables), before); assertUnreadyLegacy(database); assert.equal(objects(database).length, 26);
		database.close(); database = new DatabaseSync(path); initializeLightscaperNativeCatalogDatabaseCurrentV1(database);
		assert.equal(version(database), 4); assert.deepEqual(snapshot(database, historicalTables), before); assertUnreadyLegacy(database);
	} finally { if (database?.isOpen) { database.setAuthorizer(null); database.close(); } await rm(directory, { recursive: true, force: false }); }
});

test('Lightscaper native Legacy Query1 upgrades exact historical v1 and v2 directly without aggregate reads or changing prior row bytes', () => {
	for (const historicalVersion of [1, 2]) {
		const database = makeDatabase();
		try {
			if (historicalVersion === 1) initializeLightscaperNativeCatalogV1FixtureCurrent(database); else initializeLightscaperNativeCatalogV2FixtureCurrent(database);
			seed(database, historicalVersion); const tables = historicalTables.slice(0, historicalVersion === 1 ? 3 : 5), before = snapshot(database, tables); let aggregateReads = 0;
			forbidAggregateReads(database, () => { aggregateReads += 1; }); initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.setAuthorizer(null);
			assert.equal(version(database), 4); assert.equal(aggregateReads, 0); assert.deepEqual(snapshot(database, tables), before); assertUnreadyLegacy(database);
			assert.deepEqual(database.prepare('SELECT * FROM native_photo_stack_states ORDER BY catalog_id').all().map(row => ({ ...row })), [
				{ catalog_id: 'catalog', revision: 0, stack_count: 0 }, { catalog_id: 'empty', revision: 0, stack_count: 0 }]);
			if (historicalVersion === 1) assert.deepEqual(database.prepare('SELECT * FROM native_photo_query_builds_v2 ORDER BY catalog_id').all().map(row => ({ ...row })), [
				{ catalog_id: 'catalog', ready: 0, after_key: null, indexed_count: 0 }, { catalog_id: 'empty', ready: 0, after_key: null, indexed_count: 0 }]);
		} finally { database.setAuthorizer(null); database.close(); }
	}
});

test('Lightscaper native Legacy Query1 authenticates historical v3 DDL before adding or initializing anything', () => {
	for (const mutate of ['DROP INDEX native_photo_query_v2_file_name', 'CREATE TABLE foreign_data(value TEXT)',
		'DROP TRIGGER native_photo_stacks_forward_update; CREATE TRIGGER native_photo_stacks_forward_update AFTER UPDATE ON native_photo_stacks BEGIN SELECT 1; END']) {
		const database = makeDatabase();
		try {
			initializeLightscaperNativeCatalogV3FixtureCurrent(database); seed(database, 3); database.exec(mutate);
			const before = objects(database), rows = snapshot(database, historicalTables);
			assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database)); assert.equal(version(database), 3);
			assert.deepEqual(objects(database), before); assert.deepEqual(snapshot(database, historicalTables), rows); assert.equal(database.isTransaction, false);
		} finally { database.close(); }
	}
	const database = makeDatabase();
	try {
		for (const entry of LIGHTSCAPER_NATIVE_CATALOG_V3_SCHEMA_FIXTURE_CURRENT) database.exec(entry.sql.replace('member_position BETWEEN 0 AND 1023', 'member_position BETWEEN 0 AND 1022'));
		database.exec('PRAGMA application_id=1280525123; PRAGMA user_version=3'); const before = objects(database);
		assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database)); assert.equal(version(database), 3); assert.deepEqual(objects(database), before);
	} finally { database.close(); }
});

test('Lightscaper native Legacy Query1 rolls back every new object, build row and header after a late schema3 migration failure', () => {
	const database = makeDatabase();
	try {
		initializeLightscaperNativeCatalogV3FixtureCurrent(database); seed(database, 3); const before = objects(database), rows = snapshot(database, historicalTables); let denied = 0;
		database.setAuthorizer((action, name) => {
			if (action === constants.SQLITE_CREATE_INDEX && name === 'native_photo_query_v1_rating') { denied += 1; return constants.SQLITE_DENY; }
			return constants.SQLITE_OK;
		});
		assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database)); database.setAuthorizer(null);
		assert.equal(denied, 1); assert.equal(version(database), 3); assert.equal(database.isTransaction, false);
		assert.deepEqual(objects(database), before); assert.deepEqual(snapshot(database, historicalTables), rows);
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); assert.equal(version(database), 4); assertUnreadyLegacy(database);
	} finally { database.setAuthorizer(null); database.close(); }
});

test('Lightscaper native Legacy Query1 fresh schema authenticates every owned index and refuses changed, missing or additional schema4 bytes', () => {
	for (const mutate of ['DROP INDEX native_photo_query_v1_file_name', 'CREATE INDEX extra_legacy ON native_photo_query_rows_v1(photo_id)',
		'DROP INDEX native_photo_query_v1_rating; CREATE INDEX native_photo_query_v1_rating ON native_photo_query_rows_v1(catalog_id,photo_id,rating_sort)']) {
		const database = makeDatabase();
		try {
			initializeLightscaperNativeCatalogDatabaseCurrentV1(database); assert.equal(version(database), 4); assert.equal(objects(database).length, 26);
			assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name GLOB 'native_photo_query_v1_*' ORDER BY name").all().map(row => row.name),
				['native_photo_query_v1_capture_time', 'native_photo_query_v1_file_name', 'native_photo_query_v1_photo_id', 'native_photo_query_v1_rating']);
			for (const name of ['native_photo_query_rows_v1', 'native_photo_query_builds_v1']) assert.equal(database.prepare('SELECT strict FROM pragma_table_list WHERE name=?').get(name)?.strict, 1);
			database.exec(mutate); const before = objects(database);
			assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database)); assert.equal(version(database), 4); assert.deepEqual(objects(database), before);
		} finally { database.close(); }
	}
});

test('Lightscaper native Legacy Query1 actual schema enforces scoped custody, readiness, byte limits and delete cascades', () => {
	const database = makeDatabase();
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); seed(database, 3);
		const insert = database.prepare('INSERT INTO native_photo_query_rows_v1 VALUES (?,?,?,?,?,?,?,?,?)');
		const write = (key: string, catalog: string, photo: string, revision: number, text: string, bytes: Uint8Array, bucket: number, capture: string, rating: number) => {
			insert.run(key, catalog, photo, revision, text, bytes, bucket, capture, rating);
		};
		const bytes = new Uint8Array([0, 97]);
		assert.throws(() => write('catalog|missing', 'catalog', 'missing', 0, '{}', bytes, 1, '', 0));
		assert.throws(() => write('other|photo-0', 'other', 'photo-0', 0, '{}', bytes, 1, '', 0));
		assert.throws(() => write('wrong', 'catalog', 'photo-0', 0, '{}', bytes, 1, '', 0));
		assert.throws(() => write('catalog|photo-0', 'catalog', 'photo-0', -1, '{}', bytes, 1, '', 0));
		assert.throws(() => write('catalog|photo-0', 'catalog', 'photo-0', 0, 'ä'.repeat(262_145), bytes, 1, '', 0));
		assert.throws(() => write('catalog|photo-0', 'catalog', 'photo-0', 0, '{}', new Uint8Array([0]), 1, '', 0));
		assert.throws(() => write('catalog|photo-0', 'catalog', 'photo-0', 0, '{}', bytes, 0, '', 0));
		assert.throws(() => write('catalog|photo-0', 'catalog', 'photo-0', 0, '{}', bytes, 1, '2026-01-01T00:00:00.000', 0));
		assert.throws(() => write('catalog|photo-0', 'catalog', 'photo-0', 0, '{}', bytes, 1, '', 6));
		const build = database.prepare('INSERT INTO native_photo_query_builds_v1 VALUES (?,?,?,?)');
		assert.throws(() => build.run('missing', 0, null, 0)); assert.throws(() => build.run('catalog', 2, null, 0));
		assert.throws(() => build.run('catalog', 0, 'other|photo-0', 0)); assert.throws(() => build.run('catalog', 0, 'catalog|bad|photo', 0));
		assert.throws(() => build.run('catalog', 0, null, 10_000_001));
		write('catalog|photo-0', 'catalog', 'photo-0', 0, '{}', bytes, 1, '', 0); build.run('catalog', 1, null, 1);
		database.prepare('DELETE FROM native_photos WHERE photo_key=?').run('catalog|photo-0');
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photo_query_rows_v1').get()?.count, 0);
		database.prepare('DELETE FROM native_photo_catalogs WHERE id=?').run('catalog');
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photo_query_builds_v1').get()?.count, 0);
	} finally { database.close(); }
});
