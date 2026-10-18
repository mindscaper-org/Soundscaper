/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 as initialize } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1 as filenameKey } from '../desktop/lightscaper-native-query-records-current-v1.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { serializePhotoDocumentCurrentV1, upgradePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { upgradePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { serializePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';
import { initializeLightscaperNativeCatalogV1FixtureCurrent as v1 } from './helpers/lightscaper-native-catalog-v1-schema-fixture-current.ts';
import { initializeLightscaperNativeCatalogV2FixtureCurrent as v2 } from './helpers/lightscaper-native-catalog-v2-schema-fixture-current.ts';
import { initializeLightscaperNativeCatalogV3FixtureCurrent as v3 } from './helpers/lightscaper-native-catalog-v3-schema-fixture-current.ts';
import { initializeLightscaperNativeCatalogV4FixtureCurrent as v4, LIGHTSCAPER_NATIVE_CATALOG_V4_SCHEMA_FIXTURE_CURRENT } from './helpers/lightscaper-native-catalog-v4-schema-fixture-current.ts';

const version = (db: DatabaseSync) => db.prepare('PRAGMA user_version').get()?.user_version;
const schema = (db: DatabaseSync) => db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
const tables = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all().map(row => String(row.name));
const snapshot = (db: DatabaseSync, names: readonly string[]) => names.map(name => ({ name, rows: db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all() }));
function seed(db: DatabaseSync, version: number): void {
	const root = nativeCatalogRootCurrentV1();
	db.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(root.id, serializeLightscaperDocumentV1({ ...root, photoCount: 3 }), 0, 3, 19);
	const photos = [nativePhotoCurrentV1(), upgradePhotoDocumentV2(nativePhotoCurrentV1(1)), upgradePhotoDocumentCurrentV1(nativePhotoCurrentV1(2))];
	for (const p of photos) db.prepare('INSERT INTO native_photos VALUES (?,?,?,?,?,?)').run(photoStorageKey(p.catalogId, p.id), p.catalogId, p.id,
		p.revision, serializePhotoDocumentCurrentV1(p), JSON.stringify(photoSummary(p)));
	db.prepare('INSERT INTO native_photo_memberships VALUES (?,?,?,?)').run('catalog|collection|manual|photo-000000', 'catalog|collection|manual', 'catalog|photo-000000', 'catalog');
	if (version >= 2) {
		const row = projectPhotoQueryRowV2(photos[0]!);
		db.prepare('INSERT INTO native_photo_query_rows_v2 VALUES (?,?,?,?,?,?,?,?,?)').run(row.key, row.catalogId, row.photoId, row.photoRevision,
			JSON.stringify(row), filenameKey(row.fileNameSort), row.captureBucket, row.captureSort, row.ratingSort);
		db.prepare('INSERT INTO native_photo_query_builds_v2 VALUES (?,?,?,?)').run('catalog', 0, row.key, 1);
	}
	if (version >= 3) {
		const members = [photos[1]!.id, photos[0]!.id], document = serializePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog', id: 'group', revision: 8, photoIds: members, coverPhotoId: members[0] });
		db.prepare('INSERT INTO native_photo_stacks VALUES (?,?,?,?,?,?,?)').run('catalog|group', 'catalog', 'group', 8, document, 2, members[0]!);
		for (const [i, id] of members.entries()) db.prepare('INSERT INTO native_photo_stack_memberships VALUES (?,?,?,?,?,?)').run(`catalog|${id}`, 'catalog', id, 'catalog|group', 'group', i);
		db.prepare('INSERT INTO native_photo_stack_states VALUES (?,?,?)').run('catalog', 17, 1);
	}
	if (version >= 4) {
		const row = projectPhotoQueryRowV1(photos[1]!);
		db.prepare('INSERT INTO native_photo_query_rows_v1 VALUES (?,?,?,?,?,?,?,?,?)').run(row.key, row.catalogId, row.photoId, row.summary.photoRevision,
			JSON.stringify(row), filenameKey(row.fileNameSort), row.captureBucket, row.captureSort, row.ratingSort);
		db.prepare('INSERT INTO native_photo_query_builds_v1 VALUES (?,?,?,?)').run('catalog', 0, row.key, 1);
	}
}
function assertAbsent(db: DatabaseSync): void {
	for (const name of ['native_photo_smart_collections', 'native_photo_smart_collection_summaries', 'native_photo_smart_collection_states']) {
		assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()?.count, 0);
	}
}
function forbidAggregates(db: DatabaseSync): void {
	const existing = new Set(tables(db));
	db.setAuthorizer((action, table, column) => action === constants.SQLITE_READ && existing.has(table ?? '') && (column === 'document' || column === 'row_json')
		? constants.SQLITE_DENY : constants.SQLITE_OK);
}

test('Lightscaper native saved schema migrates literal historical v4 on disk preserving every old table byte and no physical saved state', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper saved migration ')); let db: DatabaseSync | undefined;
	try {
		const path = join(directory, 'catalog.sqlite3'); db = new DatabaseSync(path); v4(db); seed(db, 4);
		const names = tables(db), before = snapshot(db, names); assert.equal(schema(db).length, 26); db.close(); db = new DatabaseSync(path);
		forbidAggregates(db); initialize(db); db.setAuthorizer(null); assert.equal(version(db), 5); assert.equal(schema(db).length, 31);
		assert.deepEqual(snapshot(db, names), before); assertAbsent(db); assert.equal(db.isTransaction, false);
		db.close(); db = new DatabaseSync(path); initialize(db); assert.deepEqual(snapshot(db, names), before); assertAbsent(db);
	} finally { if (db?.isOpen) { db.setAuthorizer(null); db.close(); } await rm(directory, { recursive: true, force: false }); }
});

test('Lightscaper native saved schema authenticates and upgrades historical v1 v2 v3 without reading or replacing old aggregates', () => {
	for (const [index, historical] of [v1, v2, v3].entries()) {
		const db = new DatabaseSync(':memory:'); try {
			historical(db); seed(db, index + 1); const names = tables(db), before = snapshot(db, names);
			forbidAggregates(db); initialize(db); db.setAuthorizer(null); assert.equal(version(db), 5); assertAbsent(db); assert.deepEqual(snapshot(db, names), before);
		} finally { db.setAuthorizer(null); db.close(); }
	}
});

test('Lightscaper native saved schema refuses altered historic v4 DDL without adding any saved relation', () => {
	for (const mutation of ['DROP INDEX native_photo_query_v1_rating', 'CREATE TABLE foreign_payload(value TEXT)',
		'DROP TRIGGER native_photo_stacks_forward_update; CREATE TRIGGER native_photo_stacks_forward_update AFTER UPDATE ON native_photo_stacks BEGIN SELECT 1; END']) {
		const db = new DatabaseSync(':memory:'); try {
			v4(db); seed(db, 4); db.exec(mutation); const before = schema(db), rows = snapshot(db, tables(db));
			assert.throws(() => initialize(db)); assert.equal(version(db), 4); assert.deepEqual(schema(db), before); assert.deepEqual(snapshot(db, tables(db)), rows);
		} finally { db.close(); }
	}
	const db = new DatabaseSync(':memory:'); try {
		for (const entry of LIGHTSCAPER_NATIVE_CATALOG_V4_SCHEMA_FIXTURE_CURRENT) db.exec(entry.sql.replace('rating_sort BETWEEN 0 AND 5', 'rating_sort BETWEEN 0 AND 4'));
		db.exec('PRAGMA application_id=1280525123; PRAGMA user_version=4'); const before = schema(db);
		assert.throws(() => initialize(db)); assert.equal(version(db), 4); assert.deepEqual(schema(db), before);
	} finally { db.close(); }
});

test('Lightscaper native saved schema late DDL failure rolls back every new object and header while preserving old bytes', () => {
	const db = new DatabaseSync(':memory:'); try {
		v4(db); seed(db, 4); const before = schema(db), rows = snapshot(db, tables(db)); let denied = 0;
		db.setAuthorizer((action, name) => { if (action === constants.SQLITE_CREATE_INDEX && name === 'native_photo_smart_collection_summaries_catalog_key') { denied++; return constants.SQLITE_DENY; } return constants.SQLITE_OK; });
		assert.throws(() => initialize(db)); db.setAuthorizer(null); assert.equal(denied, 1); assert.equal(version(db), 4); assert.equal(db.isTransaction, false);
		assert.deepEqual(schema(db), before); assert.deepEqual(snapshot(db, tables(db)), rows); initialize(db); assert.equal(version(db), 5); assertAbsent(db);
	} finally { db.setAuthorizer(null); db.close(); }
});

test('Lightscaper native saved schema5 keeps exact STRICT relations, canonical tuples and FK custody without automatic state materialization', () => {
	const db = new DatabaseSync(':memory:'); try {
		initialize(db); assert.equal(version(db), 5); assert.equal(schema(db).length, 31); assertAbsent(db);
		const root = nativeCatalogRootCurrentV1(); db.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(root.id, serializeLightscaperDocumentV1(root), 0, 0, 0); assertAbsent(db);
		for (const name of ['native_photo_smart_collections', 'native_photo_smart_collection_summaries', 'native_photo_smart_collection_states']) assert.equal(db.prepare('SELECT strict FROM pragma_table_list WHERE name=?').get(name)?.strict, 1);
		const insert = db.prepare('INSERT INTO native_photo_smart_collection_summaries VALUES (?,?,?,?,?)');
		assert.throws(() => insert.run('["catalog", "saved"]', 'catalog', 'saved', 0, JSON.stringify('Name')));
		assert.throws(() => insert.run('["missing","saved"]', 'missing', 'saved', 0, JSON.stringify('Name')));
		assert.throws(() => db.prepare('INSERT INTO native_photo_smart_collection_states VALUES (?,?,?)').run('catalog', 0, 10_001));
		insert.run('["catalog","saved"]', 'catalog', 'saved', 0, JSON.stringify('Name')); db.prepare('DELETE FROM native_photo_catalogs WHERE id=?').run('catalog');
		assert.equal(db.prepare('SELECT COUNT(*) AS count FROM native_photo_smart_collection_summaries').get()?.count, 0);
		db.exec('DROP INDEX native_photo_smart_collections_catalog_key'); const before = schema(db); assert.throws(() => initialize(db)); assert.deepEqual(schema(db), before); assert.equal(version(db), 5);
	} finally { db.close(); }
});
