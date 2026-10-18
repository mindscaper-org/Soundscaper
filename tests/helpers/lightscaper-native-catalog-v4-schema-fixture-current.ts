/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { LIGHTSCAPER_NATIVE_CATALOG_V3_SCHEMA_FIXTURE_CURRENT } from './lightscaper-native-catalog-v3-schema-fixture-current.ts';

/** Independent historical v4 DDL at ff7d304ffdb4482aa0fd8353062bbc7ae2b7a126.
 * Legacy schema source SHA256 c1e2b7835ad614c7009bf4552ce2b5df641c1244de7190c0a8a8ded94676a233; first20 objects reuse immutable pinned v3 fixtures.
 * No production schema module is imported. */
export const LIGHTSCAPER_NATIVE_CATALOG_V4_SCHEMA_FIXTURE_CURRENT = Object.freeze([
	...LIGHTSCAPER_NATIVE_CATALOG_V3_SCHEMA_FIXTURE_CURRENT,
	{"type": "table", "name": "native_photo_query_rows_v1", "sql": "CREATE TABLE native_photo_query_rows_v1 (\n\tphoto_key TEXT PRIMARY KEY NOT NULL,\n\tcatalog_id TEXT NOT NULL CHECK (length(catalog_id) BETWEEN 1 AND 128 AND catalog_id GLOB '[A-Za-z0-9]*' AND catalog_id NOT GLOB '*[^A-Za-z0-9._:-]*'),\n\tphoto_id TEXT NOT NULL CHECK (length(photo_id) BETWEEN 1 AND 128 AND photo_id GLOB '[A-Za-z0-9]*' AND photo_id NOT GLOB '*[^A-Za-z0-9._:-]*'),\n\tphoto_revision INTEGER NOT NULL CHECK (photo_revision BETWEEN 0 AND 9007199254740991),\n\trow_json TEXT NOT NULL CHECK (length(CAST(row_json AS BLOB)) BETWEEN 1 AND 524288),\n\tfile_name_key BLOB NOT NULL CHECK (length(file_name_key) BETWEEN 2 AND 2048 AND length(file_name_key) % 2 = 0),\n\tcapture_bucket INTEGER NOT NULL CHECK (capture_bucket IN (0,1)),\n\tcapture_sort TEXT NOT NULL CHECK ((capture_bucket = 1 AND capture_sort = '') OR (capture_bucket = 0 AND length(capture_sort) = 23)),\n\trating_sort INTEGER NOT NULL CHECK (rating_sort BETWEEN 0 AND 5),\n\tCHECK (photo_key = catalog_id || '|' || photo_id),\n\tFOREIGN KEY (catalog_id, photo_key) REFERENCES native_photos(catalog_id, photo_key) ON DELETE CASCADE\n) STRICT"},
	{"type": "table", "name": "native_photo_query_builds_v1", "sql": "CREATE TABLE native_photo_query_builds_v1 (\n\tcatalog_id TEXT PRIMARY KEY NOT NULL CHECK (length(catalog_id) BETWEEN 1 AND 128 AND catalog_id GLOB '[A-Za-z0-9]*' AND catalog_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES native_photo_catalogs(id) ON DELETE CASCADE,\n\tready INTEGER NOT NULL CHECK (ready IN (0,1)),\n\tafter_key TEXT CHECK (after_key IS NULL OR (substr(after_key, 1, length(catalog_id) + 1) = catalog_id || '|' AND length(substr(after_key, length(catalog_id) + 2)) BETWEEN 1 AND 128 AND substr(after_key, length(catalog_id) + 2) GLOB '[A-Za-z0-9]*' AND substr(after_key, length(catalog_id) + 2) NOT GLOB '*[^A-Za-z0-9._:-]*')),\n\tindexed_count INTEGER NOT NULL CHECK (indexed_count BETWEEN 0 AND 10000000)\n) STRICT"},
	{"type": "index", "name": "native_photo_query_v1_photo_id", "sql": "CREATE INDEX native_photo_query_v1_photo_id ON native_photo_query_rows_v1(catalog_id, photo_id)"},
	{"type": "index", "name": "native_photo_query_v1_file_name", "sql": "CREATE INDEX native_photo_query_v1_file_name ON native_photo_query_rows_v1(catalog_id, file_name_key, photo_id)"},
	{"type": "index", "name": "native_photo_query_v1_capture_time", "sql": "CREATE INDEX native_photo_query_v1_capture_time ON native_photo_query_rows_v1(catalog_id, capture_bucket, capture_sort, photo_id)"},
	{"type": "index", "name": "native_photo_query_v1_rating", "sql": "CREATE INDEX native_photo_query_v1_rating ON native_photo_query_rows_v1(catalog_id, rating_sort, photo_id)"},
] as const);

export function initializeLightscaperNativeCatalogV4FixtureCurrent(database: DatabaseSync): void {
	database.exec('PRAGMA foreign_keys=ON');
	for (const entry of LIGHTSCAPER_NATIVE_CATALOG_V4_SCHEMA_FIXTURE_CURRENT) database.exec(entry.sql);
	database.exec('PRAGMA application_id=1280525123; PRAGMA user_version=4');
}
