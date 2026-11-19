/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { lightscaperNativeQueryFileNameKeyCurrentV1 } from '../../desktop/lightscaper-native-query-records-current-v1.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 as json } from '../../src/lightscaper/catalog/photo-document-json-v1.ts';
import { projectPhotoQueryRowV1, type PhotoQueryRowV1 } from '../../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { normalizePhotoCatalogQueryV1, type PhotoCatalogQueryV1, type PhotoQueryPageRequestV1,
	type PhotoQueryPageV1, type PhotoQueryContinuationV1 } from '../../src/lightscaper/catalog/photo-query-types-v1.ts';
import { photoStorageKey, photoSummary } from '../../src/lightscaper/catalog/repository-records.ts';
import { nativeStackQueryFixtureCurrentV1, seedNativeStackQueryCurrentV1, type NativeStackQuerySeedOptionsCurrentV1 } from './lightscaper-native-stack-query-fixture-current.ts';
export { CATALOG, key, photoId } from './lightscaper-native-stack-query-fixture-current.ts';
export const legacyQueryFixtureCurrentV1 = nativeStackQueryFixtureCurrentV1;
export interface NativeLegacyQuerySeedOptionsCurrentV1 extends NativeStackQuerySeedOptionsCurrentV1 {
	readonly ready?: boolean; readonly rows?: boolean; readonly afterKey?: string | null;
}
export function legacyQueryCurrentV1(changes: Readonly<Record<string, unknown>> = {}): PhotoCatalogQueryV1 { return normalizePhotoCatalogQueryV1(changes); }
export function seedNativeLegacyQueryCurrentV1(database: DatabaseSync, count = 130, options: NativeLegacyQuerySeedOptionsCurrentV1 = {}) {
	const f = seedNativeStackQueryCurrentV1(database, count, options), legacyRows = options.rows === false ? [] : f.photos.map(projectPhotoQueryRowV1);
	legacyTransactionCurrentV1(database, () => {
		database.prepare('INSERT INTO native_photo_query_builds_v1(catalog_id,ready,after_key,indexed_count) VALUES(?,?,?,?)')
			.run('catalog', options.ready === false ? 0 : 1, options.afterKey ?? null, legacyRows.length);
		for (const row of [...legacyRows].reverse()) putLegacyQueryRowCurrentV1(database, row);
	});
	return { ...f, legacyRows };
}
export function putLegacyQueryRowCurrentV1(database: DatabaseSync, row: PhotoQueryRowV1): void {
	database.prepare(`INSERT INTO native_photo_query_rows_v1(photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort)
		VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(photo_key) DO UPDATE SET photo_revision=excluded.photo_revision,row_json=excluded.row_json,
		file_name_key=excluded.file_name_key,capture_bucket=excluded.capture_bucket,capture_sort=excluded.capture_sort,rating_sort=excluded.rating_sort`)
		.run(row.key, row.catalogId, row.photoId, row.summary.photoRevision, json(row), lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort), row.captureBucket, row.captureSort, row.ratingSort);
}
export function replaceLegacyQuerySourceCurrentV1(database: DatabaseSync, photo: PhotoDocumentCurrentV1): void {
	const key = photoStorageKey(photo.catalogId, photo.id);
	database.prepare('UPDATE native_photos SET revision=?,document=?,summary=? WHERE photo_key=?').run(photo.revision, json(photo), json(photoSummary(photo)), key);
}
export function legacyTransactionCurrentV1<T>(database: DatabaseSync, run: () => T): T {
	database.exec('BEGIN IMMEDIATE'); try { const result = run(); database.exec('COMMIT'); return result; }
	catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
}
export function overflowLegacyQueryPhotoCurrentV1(photo: PhotoDocumentCurrentV1): PhotoDocumentCurrentV1 {
	const text = '\ud800'.repeat(16_384), ids = Array.from({ length: 1024 }, (_, index) => `member-${String(index)}-${'x'.repeat(113)}`);
	return normalizePhotoDocumentCurrentV1({ ...photo, revision: photo.revision + 1,
		metadata: { ...photo.metadata, title: text, caption: text, creator: text, location: text }, keywordIds: ids, collectionIds: ids });
}
export function collectLegacyQueryCurrentV1(database: DatabaseSync, query: PhotoCatalogQueryV1,
	read: (database: DatabaseSync, catalog: string, options?: PhotoQueryPageRequestV1) => PhotoQueryPageV1) {
	const pages: PhotoQueryPageV1[] = [], ids: string[] = []; let continuation: PhotoQueryContinuationV1 | null = null;
	do {
		const page = read(database, 'catalog', { query, continuation }); assert.ok(page.scanned <= 64 && page.items.length <= page.scanned);
		assert.ok(pages.length < 100, 'Query1 bounded positions must advance.'); assert.equal(database.isTransaction, false);
		pages.push(page); ids.push(...page.items.map(row => row.photoId)); continuation = page.continuation;
	} while (continuation);
	return { pages, ids };
}
