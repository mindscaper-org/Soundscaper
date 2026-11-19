/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

/** Literal historical schema captured independently of the v2 initializer.
 * Source HEAD3151d07db270f83d9ccdb7ef89f45306c6b6fd28;
 * desktop/lightscaper-native-catalog-database-current-v1.ts SHA256 a67126ca478494d5449dcf001ad3895861ab15360520cce09e54427baf15fdd1.
 * Keep these v1 bytes fixed when production migration changes. */
export const LIGHTSCAPER_NATIVE_CATALOG_V1_SCHEMA_FIXTURE_CURRENT = Object.freeze([
	{
		"type": "table",
		"name": "native_photo_catalogs",
		"sql": "CREATE TABLE native_photo_catalogs (\n\tid TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128 AND id GLOB '[A-Za-z0-9]*' AND id NOT GLOB '*[^A-Za-z0-9._:-]*'),\n\tdocument TEXT NOT NULL CHECK (length(CAST(document AS BLOB)) BETWEEN 1 AND 2097152),\n\troot_revision INTEGER NOT NULL CHECK (root_revision BETWEEN 0 AND 9007199254740991),\n\tphoto_count INTEGER NOT NULL CHECK (photo_count BETWEEN 0 AND 10000000),\n\tindex_revision INTEGER NOT NULL CHECK (index_revision BETWEEN 0 AND 9007199254740991)\n) STRICT"
	},
	{
		"type": "table",
		"name": "native_photos",
		"sql": "CREATE TABLE native_photos (\n\tphoto_key TEXT PRIMARY KEY NOT NULL,\n\tcatalog_id TEXT NOT NULL CHECK (length(catalog_id) BETWEEN 1 AND 128 AND catalog_id GLOB '[A-Za-z0-9]*' AND catalog_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES native_photo_catalogs(id) ON DELETE CASCADE,\n\tphoto_id TEXT NOT NULL CHECK (length(photo_id) BETWEEN 1 AND 128 AND photo_id GLOB '[A-Za-z0-9]*' AND photo_id NOT GLOB '*[^A-Za-z0-9._:-]*'),\n\trevision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),\n\tdocument TEXT NOT NULL CHECK (length(CAST(document AS BLOB)) BETWEEN 1 AND 2097152),\n\tsummary TEXT NOT NULL CHECK (length(CAST(summary AS BLOB)) BETWEEN 1 AND 4096),\n\tCHECK (photo_key = catalog_id || '|' || photo_id),\n\tUNIQUE (catalog_id, photo_key)\n) STRICT"
	},
	{
		"type": "table",
		"name": "native_photo_memberships",
		"sql": "CREATE TABLE native_photo_memberships (\n\tkey TEXT PRIMARY KEY NOT NULL CHECK (length(key) BETWEEN 1 AND 512),\n\tscope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 384 AND scope NOT GLOB '*[^A-Za-z0-9._:|-]*'),\n\tphoto_key TEXT NOT NULL,\n\tcatalog_id TEXT NOT NULL CHECK (length(catalog_id) BETWEEN 1 AND 128 AND catalog_id GLOB '[A-Za-z0-9]*' AND catalog_id NOT GLOB '*[^A-Za-z0-9._:-]*'),\n\tCHECK (substr(scope, 1, length(catalog_id) + 1) = catalog_id || '|'),\n\tCHECK (key = scope || substr(photo_key, length(catalog_id) + 1)),\n\tFOREIGN KEY (catalog_id, photo_key) REFERENCES native_photos(catalog_id, photo_key) ON DELETE CASCADE\n) STRICT"
	},
	{
		"type": "index",
		"name": "native_photos_catalog_key",
		"sql": "CREATE INDEX native_photos_catalog_key ON native_photos(catalog_id, photo_key)"
	},
	{
		"type": "index",
		"name": "native_photo_memberships_scope_key",
		"sql": "CREATE INDEX native_photo_memberships_scope_key ON native_photo_memberships(scope, key)"
	},
	{
		"type": "index",
		"name": "native_photo_memberships_photo_key",
		"sql": "CREATE INDEX native_photo_memberships_photo_key ON native_photo_memberships(photo_key)"
	}
] as const);

export function initializeLightscaperNativeCatalogV1FixtureCurrent(database: DatabaseSync): void {
	database.exec('PRAGMA foreign_keys=ON');
	for (const entry of LIGHTSCAPER_NATIVE_CATALOG_V1_SCHEMA_FIXTURE_CURRENT) database.exec(entry.sql);
	database.exec('PRAGMA application_id=1280525123; PRAGMA user_version=1');
}
