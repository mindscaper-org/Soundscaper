/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

/** Independent literal LSCP2 DDL captured from baseline 36e75d23.
 * Source SHA-256: 52716f6e7ab24f0c5ce342093e727258a295db5cacf0563c5dd809898e63e00a.
 * Never import the production initializer/DDL to create this historical fixture. */
export const LIGHTSCAPER_ORIGINAL_V2_DDL_FIXTURE_CURRENT = [
	"CREATE TABLE native_photo_original_bindings (\n\tstorage_key TEXT PRIMARY KEY NOT NULL CHECK (\n\t\tlength(storage_key) BETWEEN 1 AND 128 AND storage_key GLOB '[A-Za-z0-9]*'\n\t\tAND storage_key NOT GLOB '*[^A-Za-z0-9._:-]*'\n\t),\n\tcontent_sha256 TEXT NOT NULL CHECK (\n\t\tlength(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'\n\t),\n\tbyte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 205520896)\n) STRICT",
	"CREATE TABLE native_photo_media_assets (\n\tsource_id TEXT PRIMARY KEY NOT NULL REFERENCES native_photo_original_bindings(storage_key),\n\tsha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND length(CAST(sha256 AS BLOB)) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),\n\tsize INTEGER NOT NULL CHECK (size BETWEEN 1 AND 205520896),\n\tmedia_content_token TEXT NOT NULL CHECK (\n\t\tlength(media_content_token) BETWEEN 30 AND 142 AND length(CAST(media_content_token AS BLOB)) = length(media_content_token)\n\t\tAND substr(media_content_token,1,14) = 'media-content-' AND substr(media_content_token,15,1) GLOB '[a-z0-9]'\n\t\tAND substr(media_content_token,15) NOT GLOB '*[^a-z0-9-]*'\n\t),\n\tmetadata BLOB NOT NULL,\n\troot_count INTEGER NOT NULL CHECK (root_count BETWEEN 0 AND 9007199254740991),\n\tcommitted_at TEXT NOT NULL CHECK (length(committed_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ',committed_at) IS NOT NULL AND committed_at = strftime('%Y-%m-%dT%H:%M:%fZ',committed_at)),\n\tpending_until TEXT NOT NULL CHECK (length(pending_until) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ',pending_until) IS NOT NULL AND pending_until = strftime('%Y-%m-%dT%H:%M:%fZ',pending_until) AND pending_until > committed_at)\n) STRICT",
	"CREATE TABLE native_photo_media_roots (\n\troot_key BLOB PRIMARY KEY NOT NULL CHECK (length(root_key) BETWEEN 2 AND 4096 AND length(root_key) % 2 = 0),\n\tscope_key BLOB NOT NULL CHECK (length(scope_key) BETWEEN 2 AND 4096 AND length(scope_key) % 2 = 0),\n\tasset_id TEXT NOT NULL REFERENCES native_photo_media_assets(source_id),\n\troot TEXT NOT NULL CHECK (length(CAST(root AS BLOB)) BETWEEN 2 AND 2048 AND json_valid(root) AND root = json(root))\n) STRICT",
	"CREATE INDEX native_photo_media_assets_digest ON native_photo_media_assets(sha256,source_id)",
	"CREATE INDEX native_photo_media_roots_asset ON native_photo_media_roots(asset_id,root_key)",
	"CREATE INDEX native_photo_media_roots_scope ON native_photo_media_roots(scope_key,root_key)",
] as const;
export function initializeHistoricalLightscaperOriginalV2Current(db: DatabaseSync): void {
	for (const sql of LIGHTSCAPER_ORIGINAL_V2_DDL_FIXTURE_CURRENT) db.exec(sql);
	db.exec('PRAGMA application_id=1280525136; PRAGMA user_version=2');
}
