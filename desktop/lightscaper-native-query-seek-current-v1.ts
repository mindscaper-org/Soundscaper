/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readLightscaperNativeQueryRowCurrentV1 } from './lightscaper-native-query-records-current-v1.ts';
import type { PhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import type { PhotoQueryInclusivePosition } from '../src/lightscaper/catalog/photo-query-position.ts';
import { lightscaperNativeQuerySeekStatementCurrentV1 } from './lightscaper-native-query-seek-statement-current-v1.ts';
import { photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';

export const LIGHTSCAPER_NATIVE_QUERY_COLUMNS_CURRENT_V1 = 'photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort';

/** A single native get completes its statement before returning. There is no
 * suspended iterator to retain across another seek or the snapshot COMMIT. */
export function seekLightscaperNativeQueryRowCurrentV1(database: DatabaseSync, catalogId: string, query: PhotoCatalogQueryV2,
	bucket: 0 | 1, after: readonly (string | number)[] | null, position?: PhotoQueryInclusivePosition): PhotoQueryRowV2 | null {
	requireTransaction(database);
	const field = query.sort.field, statement = lightscaperNativeQuerySeekStatementCurrentV1(catalogId, query, bucket, after, position);
	const raw = database.prepare(`SELECT ${LIGHTSCAPER_NATIVE_QUERY_COLUMNS_CURRENT_V1} FROM native_photo_query_rows_v2 ${statement.suffix}`)
		.get(...statement.parameters);
	if (raw === undefined) return null;
	const row = readLightscaperNativeQueryRowCurrentV1(raw);
	if (row.catalogId !== catalogId || field === 'capture-time' && row.captureBucket !== bucket) throw new TypeError('Native Query2 seek leaves its catalog or capture bucket.');
	return row;
}

export function pointLightscaperNativeQueryRowCurrentV1(database: DatabaseSync, catalogId: string, photoId: string): PhotoQueryRowV2 {
	requireTransaction(database);
	const raw = database.prepare(`SELECT ${LIGHTSCAPER_NATIVE_QUERY_COLUMNS_CURRENT_V1} FROM native_photo_query_rows_v2 WHERE photo_key=?`)
		.get(photoStorageKey(catalogId, photoId));
	if (raw === undefined) throw new ReferenceError('Collapsed query stack member is missing from the ready query index.');
	const row = readLightscaperNativeQueryRowCurrentV1(raw);
	if (row.catalogId !== catalogId || row.photoId !== photoId) throw new TypeError('Native Query2 point row has another identity.');
	return row;
}
function requireTransaction(database: DatabaseSync): void { if (!database.isTransaction) throw new Error('Native Query2 seek requires one caller snapshot.'); }
