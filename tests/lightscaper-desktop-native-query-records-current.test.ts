/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1, readLightscaperNativeQueryRowCurrentV1, readLightscaperNativeQueryBuildCurrentV1 } from '../desktop/lightscaper-native-query-records-current-v1.ts';
import { getLightscaperNativeQueryBuildCurrentV1, writeLightscaperNativeQueryBuildCurrentV1, writeLightscaperNativeQueryPhotoCurrentV1 } from '../desktop/lightscaper-native-query-write-current-v1.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, upgradePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { upgradePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { PHOTO_QUERY_ROW_LIMITS_V2, projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';

const current = nativePhotoCurrentV1();
function nativeRow(photo: PhotoDocumentCurrentV1 = current, changes: Record<string, unknown> = {}) {
	const row = projectPhotoQueryRowV2(photo); return { photo_key: row.key, catalog_id: row.catalogId, photo_id: row.photoId,
		photo_revision: row.photoRevision, row_json: JSON.stringify(row), file_name_key: lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort),
		capture_bucket: row.captureBucket, capture_sort: row.captureSort, rating_sort: row.ratingSort, ...changes };
}
function withDatabase(operation: (database: DatabaseSync) => void): void {
	const database = new DatabaseSync(':memory:', { allowExtension: false, enableDoubleQuotedStringLiterals: false });
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); const root = nativeCatalogRootCurrentV1();
		database.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(root.id, serializeLightscaperDocumentV1(root), 0, 0, 0);
		operation(database);
	} finally { if (database.isTransaction) database.exec('ROLLBACK'); database.close(); }
}
function seedPhoto(database: DatabaseSync, photo: PhotoDocumentCurrentV1 = current): void {
	database.prepare(`INSERT INTO native_photos VALUES (?,?,?,?,?,?) ON CONFLICT(photo_key) DO UPDATE SET
		revision=excluded.revision,document=excluded.document,summary=excluded.summary`).run(photoStorageKey(photo.catalogId, photo.id), photo.catalogId,
		photo.id, photo.revision, serializePhotoDocumentCurrentV1(photo), JSON.stringify(photoSummary(photo)));
}
const beginBuild = (database: DatabaseSync, ready = false) => {
	database.exec('BEGIN IMMEDIATE'); writeLightscaperNativeQueryBuildCurrentV1(database, { id: 'catalog', schemaVersion: 2, ready, afterKey: null, indexedCount: 0 });
};
const build = (database: DatabaseSync) => getLightscaperNativeQueryBuildCurrentV1(database, 'catalog');
const stored = (database: DatabaseSync) => database.prepare('SELECT * FROM native_photo_query_rows_v2 WHERE photo_key=?').get(`catalog|${current.id}`);

test('Lightscaper native Query2 row reader binds all nine actual scalar and sort fields to the complete shared projection', () => {
	for (const photo of [current, upgradePhotoDocumentV2(current), upgradePhotoDocumentCurrentV1(current)]) {
		assert.deepEqual(readLightscaperNativeQueryRowCurrentV1(nativeRow(photo)), projectPhotoQueryRowV2(photo));
	}
	for (const change of [{ photo_key: 'catalog|wrong' }, { catalog_id: 'other' }, { photo_id: 'wrong' }, { photo_revision: 9 },
		{ capture_bucket: 0 }, { capture_sort: '2026-01-01T00:00:00.000' }, { rating_sort: 5 }, { extra: 1 },
		{ file_name_key: Buffer.from(current.metadata.fileName.toLowerCase(), 'utf8') }, { file_name_key: new Uint8Array([0, 97]) },
		{ row_json: '{broken' }, { row_json: JSON.stringify({ ...projectPhotoQueryRowV2(current), schemaVersion: 3 }) }]) {
		assert.throws(() => readLightscaperNativeQueryRowCurrentV1(nativeRow(current, change)));
	}
	let invoked = false; const accessor = nativeRow();
	Object.defineProperty(accessor, 'row_json', { enumerable: true, get() { invoked = true; return ''; } });
	assert.throws(() => readLightscaperNativeQueryRowCurrentV1(accessor)); assert.equal(invoked, false);
	assert.throws(() => readLightscaperNativeQueryRowCurrentV1(nativeRow(current, { row_json: 'ä'.repeat(PHOTO_QUERY_ROW_LIMITS_V2.maximumRowBytes) })), RangeError);
});

test('Lightscaper native Query2 filename BLOB order matches IndexedDB UTF-16 code units including astral, BMP and prefixes', () => {
	const values = ['z', 'aa', 'a', '\ue000', '\u{10000}', '\ud800', '\udfff', 'i\u0307.jpg'];
	const database = new DatabaseSync(':memory:');
	try {
		database.exec('CREATE TABLE ordering(value TEXT,key BLOB) STRICT');
		for (const [index, value] of values.entries()) database.prepare('INSERT INTO ordering VALUES (?,?)').run(String(index), lightscaperNativeQueryFileNameKeyCurrentV1(value));
		assert.deepEqual(database.prepare('SELECT value FROM ordering ORDER BY key').all().map(row => values[Number(row.value)]), [...values].sort());
		assert.deepEqual(lightscaperNativeQueryFileNameKeyCurrentV1('\u{10000}'), new Uint8Array([0xd8, 0, 0xdc, 0]));
		assert.deepEqual(lightscaperNativeQueryFileNameKeyCurrentV1('\ue000'), new Uint8Array([0xe0, 0]));
		assert.deepEqual(lightscaperNativeQueryFileNameKeyCurrentV1('I'), new Uint8Array([0, 0x49]));
		const expanding = normalizePhotoDocumentCurrentV1({ ...current, metadata: { ...current.metadata, fileName: 'İ'.repeat(256) } });
		assert.deepEqual(readLightscaperNativeQueryRowCurrentV1(nativeRow(expanding)), projectPhotoQueryRowV2(expanding));
	} finally { database.close(); }
});

test('Lightscaper native Query2 build reader maps only exact native fields and validates catalog-scoped cursor and bounded count', () => {
	const row = { catalog_id: 'catalog', ready: 0, after_key: `catalog|${current.id}`, indexed_count: 2 };
	assert.deepEqual(readLightscaperNativeQueryBuildCurrentV1(row, 'catalog'), { id: 'catalog', schemaVersion: 2, ready: false, afterKey: row.after_key, indexedCount: 2 });
	for (const change of [{ catalog_id: 'other' }, { ready: true }, { ready: 2 }, { after_key: 'other|photo' }, { after_key: 'catalog|wrong|photo' },
		{ indexed_count: -1 }, { indexed_count: 10_000_001 }, { extra: 1 }]) assert.throws(() => readLightscaperNativeQueryBuildCurrentV1({ ...row, ...change }, 'catalog'));
	assert.throws(() => readLightscaperNativeQueryBuildCurrentV1(row, 'other'));
});

test('Lightscaper native Query2 writer publishes genuine Current rows and counts each physical row once across insert, replace and rebuild', () => {
	withDatabase(database => {
		assert.equal(build(database), null); seedPhoto(database);
		assert.throws(() => writeLightscaperNativeQueryPhotoCurrentV1(database, current, 'insert'));
		assert.throws(() => writeLightscaperNativeQueryBuildCurrentV1(database, { id: 'catalog', schemaVersion: 2, ready: true, afterKey: null, indexedCount: 0 }));
		beginBuild(database, true); writeLightscaperNativeQueryPhotoCurrentV1(database, current, 'insert');
		assert.equal(build(database)?.indexedCount, 1); assert.deepEqual(readLightscaperNativeQueryRowCurrentV1(stored(database)), projectPhotoQueryRowV2(current));
		const changed = normalizePhotoDocumentCurrentV1({ ...current, revision: 1, rating: 5 }); seedPhoto(database, changed);
		writeLightscaperNativeQueryPhotoCurrentV1(database, changed, 'replace'); writeLightscaperNativeQueryPhotoCurrentV1(database, changed, 'rebuild');
		assert.equal(build(database)?.indexedCount, 1); assert.deepEqual(readLightscaperNativeQueryRowCurrentV1(stored(database)), projectPhotoQueryRowV2(changed));
		database.exec('COMMIT'); assert.equal(build(database)?.ready, true);
	});
});

test('Lightscaper native Query2 refuses missing build, duplicate insert, ready replacement gaps and native source revision mismatch', () => {
	withDatabase(database => {
		seedPhoto(database); database.exec('BEGIN IMMEDIATE');
		assert.throws(() => writeLightscaperNativeQueryPhotoCurrentV1(database, current, 'rebuild')); assert.equal(build(database), null);
		database.exec('ROLLBACK'); beginBuild(database, true);
		assert.throws(() => writeLightscaperNativeQueryPhotoCurrentV1(database, current, 'replace'));
		writeLightscaperNativeQueryPhotoCurrentV1(database, current, 'insert'); assert.throws(() => writeLightscaperNativeQueryPhotoCurrentV1(database, current, 'insert'));
		seedPhoto(database, normalizePhotoDocumentCurrentV1({ ...current, revision: 1 }));
		assert.throws(() => writeLightscaperNativeQueryPhotoCurrentV1(database, current, 'replace'));
		database.prepare('UPDATE native_photo_query_builds_v2 SET indexed_count=0').run();
		assert.throws(() => writeLightscaperNativeQueryPhotoCurrentV1(database, normalizePhotoDocumentCurrentV1({ ...current, revision: 1 }), 'rebuild'));
	});
});

test('Lightscaper native Query2 partial rebuild permits missing replacements and behind-cursor inserts without double counting', () => {
	withDatabase(database => {
		beginBuild(database); writeLightscaperNativeQueryBuildCurrentV1(database, { id: 'catalog', schemaVersion: 2, ready: false, afterKey: 'catalog|photo-999999', indexedCount: 0 });
		seedPhoto(database); writeLightscaperNativeQueryPhotoCurrentV1(database, current, 'replace');
		writeLightscaperNativeQueryPhotoCurrentV1(database, current, 'rebuild'); assert.equal(build(database)?.indexedCount, 1);
		const next = nativePhotoCurrentV1(1); seedPhoto(database, next); writeLightscaperNativeQueryPhotoCurrentV1(database, next, 'insert');
		assert.equal(build(database)?.indexedCount, 2); assert.equal(build(database)?.afterKey, 'catalog|photo-999999'); assert.equal(build(database)?.ready, false);
	});
});

test('Lightscaper native Query2 SQL failure remains inside the caller transaction and rolls back source, derived row and build count together', () => {
	withDatabase(database => {
		beginBuild(database); database.exec('COMMIT');
		database.exec("CREATE TRIGGER fail_query AFTER INSERT ON native_photo_query_rows_v2 BEGIN SELECT RAISE(ABORT,'query failed'); END");
		database.exec('BEGIN IMMEDIATE'); seedPhoto(database);
		assert.throws(() => writeLightscaperNativeQueryPhotoCurrentV1(database, current, 'insert'), /query failed/u); assert.equal(database.isTransaction, true);
		database.exec('ROLLBACK'); assert.equal(stored(database), undefined); assert.equal(build(database)?.indexedCount, 0);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photos').get()?.count, 0);
		database.exec('DROP TRIGGER fail_query'); database.exec('BEGIN IMMEDIATE'); seedPhoto(database); writeLightscaperNativeQueryPhotoCurrentV1(database, current, 'insert'); database.exec('COMMIT');
		database.prepare('DELETE FROM native_photo_catalogs WHERE id=?').run('catalog');
		assert.equal(build(database), null); assert.equal(stored(database), undefined);
	});
});
