/* SPDX-License-Identifier: AGPL-3.0-only */
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openLightscaperNativePhotoLibraryDatabaseCurrentV1 } from './lightscaper-native-photo-library-files-current-v1.ts';
export const LIGHTSCAPER_NATIVE_PHOTO_PREVIEW_CHUNK_CURRENT_V1 = 1048576;
export const LIGHTSCAPER_NATIVE_PHOTO_PREVIEW_MAXIMUM_BYTES_CURRENT_V1 = 134217728;
export const LIGHTSCAPER_NATIVE_PHOTO_PREVIEW_MAXIMUM_ENTRIES_CURRENT_V1 = 1024;
const APPLICATION = 0x4c535043;
const SCHEMA = [
	`CREATE TABLE native_photo_preview_bodies (
		token TEXT PRIMARY KEY NOT NULL CHECK(length(CAST(token AS BLOB))=32 AND token NOT GLOB '*[^0-9a-f]*'),
		byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 0 AND 134217728),
		chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 0 AND 128 AND chunk_count=(byte_length+1048575)/1048576)
	) STRICT`,
	`CREATE TABLE native_photo_preview_chunks (
		body_token TEXT NOT NULL REFERENCES native_photo_preview_bodies(token) ON DELETE CASCADE,
		position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 127),
		body BLOB NOT NULL CHECK(length(body) BETWEEN 1 AND 1048576),
		PRIMARY KEY(body_token,position)
	) STRICT`,
	`CREATE TABLE native_photo_preview_entries (
		key TEXT PRIMARY KEY NOT NULL CHECK(length(CAST(key AS BLOB)) BETWEEN 1 AND 256 AND key NOT GLOB '*[^A-Za-z0-9._:-]*'),
		manifest TEXT NOT NULL CHECK(length(CAST(manifest AS BLOB)) BETWEEN 2 AND 4096 AND json_valid(manifest)),
		source_token TEXT NOT NULL CHECK(length(CAST(source_token AS BLOB)) BETWEEN 30 AND 142),
		output_sha256 TEXT NOT NULL CHECK(length(CAST(output_sha256 AS BLOB))=64 AND output_sha256 NOT GLOB '*[^0-9a-f]*'),
		body_token TEXT UNIQUE NOT NULL REFERENCES native_photo_preview_bodies(token),
		byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 0 AND 134217728),
		mime_type TEXT NOT NULL CHECK(length(CAST(mime_type AS BLOB))<=256),
		committed_at INTEGER NOT NULL CHECK(committed_at BETWEEN 0 AND 9007199254740991)
	) STRICT`,
	`CREATE TABLE native_photo_preview_staging (
		singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
		body_token TEXT UNIQUE NOT NULL REFERENCES native_photo_preview_bodies(token)
	) STRICT`,
	'CREATE INDEX native_photo_preview_entries_oldest ON native_photo_preview_entries(committed_at,key)',
] as const;
const OBJECTS = SCHEMA.map(sql => ({ type: sql.startsWith('CREATE INDEX') ? 'index' : 'table', name: sql.split(' ')[2]!, sql }))
	.sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
export function lightscaperNativePhotoPreviewDatabasePathCurrentV1(appDataPath: string): string {
	return join(appDataPath, 'Lightscaper', 'project-library', 'v1', 'native-photo-preview-cache.sqlite3');
}
export function inspectLightscaperNativePhotoPreviewDatabaseCurrentV1(db: DatabaseSync): 'empty' | 'owned' {
	const application = db.prepare('PRAGMA application_id').get()?.application_id, version = db.prepare('PRAGMA user_version').get()?.user_version;
	const rows = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name LIMIT 6").all();
	if (application === 0 && version === 0 && !rows.length) return 'empty';
	if (application !== APPLICATION || version !== 1 || rows.length !== OBJECTS.length || rows.some((row, i) => {
		const expected = OBJECTS[i]; return !expected || row.type !== expected.type || row.name !== expected.name || row.sql !== expected.sql;
	})) throw new Error('Native preview cache requires its exact owned schema.');
	return 'owned';
}
export function initializeLightscaperNativePhotoPreviewDatabaseCurrentV1(db: DatabaseSync): void {
	if (db.isTransaction) throw new Error('Native preview initialization requires an idle database.');
	db.exec('BEGIN IMMEDIATE');
	try {
		if (inspectLightscaperNativePhotoPreviewDatabaseCurrentV1(db) === 'empty') {
			for (const sql of SCHEMA) db.exec(sql); db.exec(`PRAGMA application_id=${APPLICATION}`); db.exec('PRAGMA user_version=1');
		}
		inspectLightscaperNativePhotoPreviewDatabaseCurrentV1(db); db.exec('COMMIT');
	} catch (primary) {
		try { if (db.isTransaction) db.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native preview initialization and rollback failed.', { cause: cleanup }); } throw primary;
	}
}
export function openLightscaperNativePhotoPreviewDatabaseCurrentV1(appDataPath: string): Promise<DatabaseSync> {
	return openLightscaperNativePhotoLibraryDatabaseCurrentV1(appDataPath, Object.freeze({ fileName: 'native-photo-preview-cache.sqlite3',
		inspect: inspectLightscaperNativePhotoPreviewDatabaseCurrentV1, initialize: initializeLightscaperNativePhotoPreviewDatabaseCurrentV1 }));
}
