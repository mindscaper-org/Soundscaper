/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import type { PhotoQueryBuildStateV2 } from '../src/lightscaper/catalog/photo-query-index-storage-v2.ts';
import { field, id, oneOf, record } from '../src/lightscaper/catalog/value-validation.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1, readLightscaperNativeQueryBuildCurrentV1, readLightscaperNativeQueryRowCurrentV1 } from './lightscaper-native-query-records-current-v1.ts';

export function getLightscaperNativeQueryBuildCurrentV1(database: DatabaseSync, value: unknown): PhotoQueryBuildStateV2 | null {
	const catalogId = id(value, 'native query2 catalog');
	const row = database.prepare('SELECT catalog_id,ready,after_key,indexed_count FROM native_photo_query_builds_v2 WHERE catalog_id=?').get(catalogId);
	return row === undefined ? null : readLightscaperNativeQueryBuildCurrentV1(row, catalogId);
}

/** The catalog creator, row writer and bounded rebuilder share their caller's
 * actual immediate transaction; this helper never opens a nested transaction. */
export function writeLightscaperNativeQueryBuildCurrentV1(database: DatabaseSync, value: unknown): void {
	requireTransaction(database);
	const input = record(value, 'native query2 build publication', ['id', 'schemaVersion', 'ready', 'afterKey', 'indexedCount']);
	const ready = field(input, 'ready');
	if (field(input, 'schemaVersion') !== 2 || typeof ready !== 'boolean') throw new TypeError('Native query2 build requires its exact shared profile.');
	const catalogId = id(field(input, 'id'), 'native query2 catalog');
	const build = readLightscaperNativeQueryBuildCurrentV1({ catalog_id: catalogId, ready: ready ? 1 : 0,
		after_key: field(input, 'afterKey'), indexed_count: field(input, 'indexedCount') }, catalogId);
	// Existing malformed state must not be silently replaced by a valid caller.
	getLightscaperNativeQueryBuildCurrentV1(database, catalogId);
	database.prepare(`INSERT INTO native_photo_query_builds_v2(catalog_id,ready,after_key,indexed_count) VALUES (?,?,?,?)
		ON CONFLICT(catalog_id) DO UPDATE SET ready=excluded.ready,after_key=excluded.after_key,indexed_count=excluded.indexed_count`)
		.run(build.id, build.ready ? 1 : 0, build.afterKey, build.indexedCount);
}

/** Only a genuine Current1/2/3 source is projected. Original custody admission
 * remains with the catalog write owner; a metadata rebuild never reads bodies. */
export function writeLightscaperNativeQueryPhotoCurrentV1(database: DatabaseSync, value: unknown, mode: 'insert' | 'replace' | 'rebuild'): void {
	requireTransaction(database);
	const admittedMode = oneOf(mode, ['insert', 'replace', 'rebuild'] as const, 'native query2 publication mode');
	const photo = normalizePhotoDocumentCurrentV1(value), row = projectPhotoQueryRowV2(photo);
	const source = database.prepare('SELECT photo_key,catalog_id,photo_id,revision FROM native_photos WHERE photo_key=?').get(row.key);
	if (source === undefined || source.photo_key !== row.key || source.catalog_id !== row.catalogId || source.photo_id !== row.photoId || source.revision !== row.photoRevision) {
		throw new TypeError('Native query2 publication disagrees with its actual source identity or revision.');
	}
	const build = getLightscaperNativeQueryBuildCurrentV1(database, row.catalogId);
	if (build === null) throw new TypeError('Native query2 publication requires an owned build state.');
	const previous = database.prepare(`SELECT photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort
		FROM native_photo_query_rows_v2 WHERE photo_key=?`).get(row.key);
	if (previous !== undefined) {
		readLightscaperNativeQueryRowCurrentV1(previous);
		if (build.indexedCount === 0 || admittedMode === 'insert') throw new TypeError('Native query2 existing row or build count conflicts with publication.');
	} else if (admittedMode === 'replace' && build.ready) throw new TypeError('Ready native query2 replacement row is missing.');
	const next = previous === undefined ? readLightscaperNativeQueryBuildCurrentV1({ catalog_id: build.id, ready: build.ready ? 1 : 0,
		after_key: build.afterKey, indexed_count: build.indexedCount + 1 }, build.id) : build;
	database.prepare(`INSERT INTO native_photo_query_rows_v2(photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort)
		VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(photo_key) DO UPDATE SET catalog_id=excluded.catalog_id,photo_id=excluded.photo_id,
		photo_revision=excluded.photo_revision,row_json=excluded.row_json,file_name_key=excluded.file_name_key,
		capture_bucket=excluded.capture_bucket,capture_sort=excluded.capture_sort,rating_sort=excluded.rating_sort`)
		.run(row.key, row.catalogId, row.photoId, row.photoRevision, JSON.stringify(row), lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort), row.captureBucket, row.captureSort, row.ratingSort);
	if (previous === undefined) writeLightscaperNativeQueryBuildCurrentV1(database, next);
}
function requireTransaction(database: DatabaseSync): void {
	if (!database.isTransaction) throw new Error('Native query2 publication requires its caller transaction.');
}
