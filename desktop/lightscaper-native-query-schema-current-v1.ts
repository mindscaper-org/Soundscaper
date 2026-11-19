/* SPDX-License-Identifier: AGPL-3.0-only */

import { LIGHTSCAPER_CATALOG_LIMITS } from '../src/lightscaper/catalog/types.ts';
import { PHOTO_QUERY_ROW_LIMITS_V2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';

const stable = (column: string) => `length(${column}) BETWEEN 1 AND 128 AND ${column} GLOB '[A-Za-z0-9]*' AND ${column} NOT GLOB '*[^A-Za-z0-9._:-]*'`;

/** Exact owned additions to LSCC v2. Existing v1 DDL remains independently
 * authenticated before any migration statement runs. */
export const LIGHTSCAPER_NATIVE_QUERY_SCHEMA_CURRENT_V1 = Object.freeze([
	{ type: 'table', name: 'native_photo_query_rows_v2', sql: `CREATE TABLE native_photo_query_rows_v2 (
	photo_key TEXT PRIMARY KEY NOT NULL,
	catalog_id TEXT NOT NULL CHECK (${stable('catalog_id')}),
	photo_id TEXT NOT NULL CHECK (${stable('photo_id')}),
	photo_revision INTEGER NOT NULL CHECK (photo_revision BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}),
	row_json TEXT NOT NULL CHECK (length(CAST(row_json AS BLOB)) BETWEEN 1 AND ${PHOTO_QUERY_ROW_LIMITS_V2.maximumRowBytes}),
	file_name_key BLOB NOT NULL CHECK (length(file_name_key) BETWEEN 2 AND 2048 AND length(file_name_key) % 2 = 0),
	capture_bucket INTEGER NOT NULL CHECK (capture_bucket IN (0,1)),
	capture_sort TEXT NOT NULL CHECK ((capture_bucket = 1 AND capture_sort = '') OR (capture_bucket = 0 AND length(capture_sort) = 23)),
	rating_sort INTEGER NOT NULL CHECK (rating_sort BETWEEN 0 AND 5),
	CHECK (photo_key = catalog_id || '|' || photo_id),
	FOREIGN KEY (catalog_id, photo_key) REFERENCES native_photos(catalog_id, photo_key) ON DELETE CASCADE
) STRICT` },
	{ type: 'table', name: 'native_photo_query_builds_v2', sql: `CREATE TABLE native_photo_query_builds_v2 (
	catalog_id TEXT PRIMARY KEY NOT NULL CHECK (${stable('catalog_id')}) REFERENCES native_photo_catalogs(id) ON DELETE CASCADE,
	ready INTEGER NOT NULL CHECK (ready IN (0,1)),
	after_key TEXT CHECK (after_key IS NULL OR (substr(after_key, 1, length(catalog_id) + 1) = catalog_id || '|' AND ${stable('substr(after_key, length(catalog_id) + 2)')})),
	indexed_count INTEGER NOT NULL CHECK (indexed_count BETWEEN 0 AND ${LIGHTSCAPER_CATALOG_LIMITS.maximumPhotos})
) STRICT` },
	{ type: 'index', name: 'native_photo_query_v2_photo_id', sql: 'CREATE INDEX native_photo_query_v2_photo_id ON native_photo_query_rows_v2(catalog_id, photo_id)' },
	{ type: 'index', name: 'native_photo_query_v2_file_name', sql: 'CREATE INDEX native_photo_query_v2_file_name ON native_photo_query_rows_v2(catalog_id, file_name_key, photo_id)' },
	{ type: 'index', name: 'native_photo_query_v2_capture_time', sql: 'CREATE INDEX native_photo_query_v2_capture_time ON native_photo_query_rows_v2(catalog_id, capture_bucket, capture_sort, photo_id)' },
	{ type: 'index', name: 'native_photo_query_v2_rating', sql: 'CREATE INDEX native_photo_query_v2_rating ON native_photo_query_rows_v2(catalog_id, rating_sort, photo_id)' },
]);
