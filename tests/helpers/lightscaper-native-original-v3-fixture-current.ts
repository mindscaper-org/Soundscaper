/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DatabaseSync } from 'node:sqlite';
import { initializeHistoricalLightscaperOriginalV2Current } from './lightscaper-native-original-v2-fixture-current.ts';

/** Independent historical LSCP3 literals, captured from schema source
 * cd30dada7f2cc317c724cff7d879c69814c9c5e75a8b9664e55f18e48f3bcb41.
 * Never call the live initializer to construct this historical fixture. */
export const LIGHTSCAPER_ORIGINAL_V3_ADDITIONS_FIXTURE_CURRENT = [
	`CREATE TABLE native_photo_original_body_locators (
	content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64 AND length(CAST(content_sha256 AS BLOB)) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
	locator_id TEXT NOT NULL CHECK (locator_id = 'legacy' OR (length(locator_id) = 64 AND length(CAST(locator_id AS BLOB)) = 64 AND locator_id NOT GLOB '*[^0-9a-f]*')),
	byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 205520896),
	layout TEXT NOT NULL CHECK ((locator_id = 'legacy' AND layout = 'legacy-sha-v1') OR (locator_id <> 'legacy' AND layout = 'generation-v1')),
	PRIMARY KEY(content_sha256,locator_id),
	UNIQUE(content_sha256,locator_id,byte_length)
) STRICT`,
	`CREATE TABLE native_photo_original_body_heads (
	content_sha256 TEXT PRIMARY KEY NOT NULL CHECK (length(content_sha256) = 64 AND length(CAST(content_sha256 AS BLOB)) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
	locator_id TEXT NOT NULL CHECK (locator_id = 'legacy' OR (length(locator_id) = 64 AND length(CAST(locator_id AS BLOB)) = 64 AND locator_id NOT GLOB '*[^0-9a-f]*')),
	byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 205520896),
	revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
	FOREIGN KEY(content_sha256,locator_id,byte_length) REFERENCES native_photo_original_body_locators(content_sha256,locator_id,byte_length)
) STRICT`,
	'CREATE INDEX native_photo_original_bindings_digest ON native_photo_original_bindings(content_sha256,byte_length,storage_key)',
] as const;

export function initializeHistoricalLightscaperOriginalV3Current(database: DatabaseSync): void {
	initializeHistoricalLightscaperOriginalV2Current(database);
	for (const sql of LIGHTSCAPER_ORIGINAL_V3_ADDITIONS_FIXTURE_CURRENT) database.exec(sql);
	database.exec('PRAGMA user_version=3');
}
