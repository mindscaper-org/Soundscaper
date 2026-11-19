/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

/** Independent literal resolved DDL captured from committed 5b374e6f3df763522da6291f689e9e204c80426c.
 * Never import a current production schema to construct this historical file. */
export const LIGHTSCAPER_ORIGINAL_V1_DDL_FIXTURE_CURRENT = `CREATE TABLE native_photo_original_bindings (
	storage_key TEXT PRIMARY KEY NOT NULL CHECK (
		length(storage_key) BETWEEN 1 AND 128 AND storage_key GLOB '[A-Za-z0-9]*'
		AND storage_key NOT GLOB '*[^A-Za-z0-9._:-]*'
	),
	content_sha256 TEXT NOT NULL CHECK (
		length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'
	),
	byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 205520896)
) STRICT`;

export function initializeHistoricalLightscaperOriginalV1Current(db: DatabaseSync): void {
	db.exec(LIGHTSCAPER_ORIGINAL_V1_DDL_FIXTURE_CURRENT);
	db.exec('PRAGMA application_id=1280525136; PRAGMA user_version=1');
}
