/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readLightscaperNativeLegacyQueryRowCurrentV1 } from './lightscaper-native-legacy-query-records-current-v1.ts';
import { lightscaperNativeQuerySeekStatementCurrentV1 } from './lightscaper-native-query-seek-statement-current-v1.ts';
import type { PhotoCatalogQueryV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import type { PhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import type { PhotoQueryInclusivePosition } from '../src/lightscaper/catalog/photo-query-position.ts';
import { photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';

export const LIGHTSCAPER_NATIVE_LEGACY_QUERY_COLUMNS_CURRENT_V1 = 'photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort';

/** Fixed Row1/table authority. Only an owning transaction may supply a private
 * inclusive position; public adapters never expose that flag or parameter. */
export function seekLightscaperNativeLegacyQueryRowCurrentV1(database: DatabaseSync, catalogId: string, query: PhotoCatalogQueryV1,
	bucket: 0 | 1, after: readonly (string | number)[] | null, position?: PhotoQueryInclusivePosition): PhotoQueryRowV1 | null {
	requireTransaction(database);
	const { suffix, parameters } = lightscaperNativeQuerySeekStatementCurrentV1(catalogId, query, bucket, after, position);
	const raw = database.prepare(`SELECT ${LIGHTSCAPER_NATIVE_LEGACY_QUERY_COLUMNS_CURRENT_V1} FROM native_photo_query_rows_v1 ${suffix}`).get(...parameters);
	if (raw === undefined) return null;
	const row = readLightscaperNativeLegacyQueryRowCurrentV1(raw);
	if (row.catalogId !== catalogId || query.sort.field === 'capture-time' && row.captureBucket !== bucket) throw new TypeError('Native legacy query seek leaves its catalog or capture bucket.');
	return row;
}
export function pointLightscaperNativeLegacyQueryRowCurrentV1(database: DatabaseSync, catalogId: string, photoId: string): PhotoQueryRowV1 {
	requireTransaction(database);
	const raw = database.prepare(`SELECT ${LIGHTSCAPER_NATIVE_LEGACY_QUERY_COLUMNS_CURRENT_V1} FROM native_photo_query_rows_v1 WHERE photo_key=?`).get(photoStorageKey(catalogId, photoId));
	if (raw === undefined) throw new ReferenceError('Collapsed legacy query stack member is missing from its ready index.');
	const row = readLightscaperNativeLegacyQueryRowCurrentV1(raw);
	if (row.catalogId !== catalogId || row.photoId !== photoId) throw new TypeError('Native legacy query point row has another identity.');
	return row;
}
function requireTransaction(database: DatabaseSync): void { if (!database.isTransaction) throw new Error('Native legacy query seek requires one caller snapshot.'); }
