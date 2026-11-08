/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { projectPhotoQueryRowV1, type PhotoQueryBuildStateV1, type PhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { field, id, oneOf, record } from '../src/lightscaper/catalog/value-validation.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1 } from './lightscaper-native-query-records-current-v1.ts';
import { readLightscaperNativeLegacyQueryBuildCurrentV1, readLightscaperNativeLegacyQueryRowCurrentV1 } from './lightscaper-native-legacy-query-records-current-v1.ts';

const COLUMNS = 'photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort';
export function getLightscaperNativeLegacyQueryBuildCurrentV1(database: DatabaseSync, value: unknown): PhotoQueryBuildStateV1 | null {
	const catalogId = id(value, 'native legacy query catalog');
	const row = database.prepare('SELECT catalog_id,ready,after_key,indexed_count FROM native_photo_query_builds_v1 WHERE catalog_id=?').get(catalogId);
	return row === undefined ? null : readLightscaperNativeLegacyQueryBuildCurrentV1(row, catalogId);
}
export function writeLightscaperNativeLegacyQueryBuildCurrentV1(database: DatabaseSync, value: unknown): void {
	requireTransaction(database);
	const input = record(value, 'native legacy query build publication', ['id','schemaVersion','ready','afterKey','indexedCount']);
	const ready = field(input, 'ready'), catalogId = id(field(input, 'id'), 'native legacy build catalog');
	if (field(input, 'schemaVersion') !== 1 || typeof ready !== 'boolean') throw new TypeError('Native legacy build requires its exact shared profile.');
	const build = readLightscaperNativeLegacyQueryBuildCurrentV1({ catalog_id: catalogId, ready: ready ? 1 : 0,
		after_key: field(input, 'afterKey'), indexed_count: field(input, 'indexedCount') }, catalogId);
	getLightscaperNativeLegacyQueryBuildCurrentV1(database, catalogId);
	database.prepare(`INSERT INTO native_photo_query_builds_v1(catalog_id,ready,after_key,indexed_count) VALUES(?,?,?,?)
		ON CONFLICT(catalog_id) DO UPDATE SET ready=excluded.ready,after_key=excluded.after_key,indexed_count=excluded.indexed_count`)
		.run(build.id, build.ready ? 1 : 0, build.afterKey, build.indexedCount);
}

/** Actual Current sources own projection. Only the exact synchronous Row1
 * budget refusal retires a legacy profile; all native SQL failures propagate.
 * The caller's transaction also owns Photo/summary/Row2/root publication. */
export function writeLightscaperNativeLegacyQueryPhotoCurrentV1(database: DatabaseSync, value: unknown, mode: 'insert' | 'replace' | 'rebuild'): void {
	requireTransaction(database); const admittedMode = oneOf(mode, ['insert','replace','rebuild'] as const, 'native legacy query publication mode');
	const photo = normalizePhotoDocumentCurrentV1(value), key = `${photo.catalogId}|${photo.id}`;
	const source = database.prepare('SELECT photo_key,catalog_id,photo_id,revision FROM native_photos WHERE photo_key=?').get(key);
	if (!source || source.photo_key !== key || source.catalog_id !== photo.catalogId || source.photo_id !== photo.id || source.revision !== photo.revision) {
		throw new TypeError('Native legacy projection disagrees with its actual source identity or revision.');
	}
	const build = getLightscaperNativeLegacyQueryBuildCurrentV1(database, photo.catalogId);
	if (!build) throw new TypeError('Native legacy projection requires an owned build state.');
	const previous = database.prepare(`SELECT ${COLUMNS} FROM native_photo_query_rows_v1 WHERE photo_key=?`).get(key);
	if (previous !== undefined) {
		readLightscaperNativeLegacyQueryRowCurrentV1(previous);
		if (build.indexedCount === 0 || admittedMode === 'insert') throw new TypeError('Native legacy existing row conflicts with its build or insertion.');
	} else if (admittedMode === 'replace' && build.ready) throw new TypeError('Ready native legacy replacement row is missing.');
	let row: PhotoQueryRowV1;
	try { row = projectPhotoQueryRowV1(photo); }
	catch (error) {
		if (admittedMode === 'rebuild' || !(error instanceof RangeError) || error.message !== 'Photo query row exceeds its byte budget.') throw error;
		writeLightscaperNativeLegacyQueryBuildCurrentV1(database, { ...build, ready: false, afterKey: null }); return;
	}
	const next = previous === undefined ? readLightscaperNativeLegacyQueryBuildCurrentV1({ catalog_id: build.id,
		ready: build.ready ? 1 : 0, after_key: build.afterKey, indexed_count: build.indexedCount + 1 }, build.id) : build;
	database.prepare(`INSERT INTO native_photo_query_rows_v1(${COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?)
		ON CONFLICT(photo_key) DO UPDATE SET photo_revision=excluded.photo_revision,row_json=excluded.row_json,
		file_name_key=excluded.file_name_key,capture_bucket=excluded.capture_bucket,capture_sort=excluded.capture_sort,rating_sort=excluded.rating_sort`)
		.run(row.key, row.catalogId, row.photoId, row.summary.photoRevision, JSON.stringify(row), lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort), row.captureBucket, row.captureSort, row.ratingSort);
	if (previous === undefined) writeLightscaperNativeLegacyQueryBuildCurrentV1(database, next);
}
function requireTransaction(database: DatabaseSync): void { if (!database.isTransaction) throw new Error('Native legacy query publication requires an active caller transaction.'); }
