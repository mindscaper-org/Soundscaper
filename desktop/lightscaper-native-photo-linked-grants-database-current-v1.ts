/* SPDX-License-Identifier: AGPL-3.0-only */
import { isAbsolute, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { readLinkedGrantNamespaceCurrentV1, type LinkedGrantNamespaceCurrentV1 } from './lightscaper-native-photo-linked-grants-binding-current-v1.ts';
import { createLinkedGrantCleanupFailureCurrentV1 as cleanup } from './lightscaper-native-photo-linked-grants-failures-current-v1.ts';
const APPLICATION = 0x4c534c47, VERSION = 1, TABLE = 'native_photo_linked_root_grants';
const OWNER = `CREATE TABLE native_photo_linked_grant_owner (
	singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
	media_path TEXT NOT NULL,
	media_device TEXT NOT NULL,
	media_inode TEXT NOT NULL
) STRICT`;
const SCHEMA = `CREATE TABLE native_photo_linked_root_grants (
	grant_id TEXT PRIMARY KEY NOT NULL,
	display_name TEXT NOT NULL,
	path_encoding TEXT NOT NULL,
	native_path BLOB NOT NULL,
	volume_identity TEXT NOT NULL,
	object_identity TEXT NOT NULL,
	revision INTEGER NOT NULL,
	revoked INTEGER NOT NULL,
	CHECK(length(grant_id)=64 AND grant_id NOT GLOB '*[^0-9a-f]*'),
	CHECK(path_encoding IN ('posix-bytes','windows-utf16le')),
	CHECK(length(native_path)>0 AND length(native_path)<=262144),
	CHECK(path_encoding!='windows-utf16le' OR length(native_path)%2=0),
	CHECK(revision>=0 AND revision<=9007199254740991),
	CHECK(revoked IN (0,1))
) STRICT`;
export function deriveLightscaperNativePhotoLinkedGrantPathsCurrentV1(appDataPath: string) {
	if (typeof appDataPath !== 'string' || appDataPath.includes('\0') || !isAbsolute(appDataPath) || resolve(appDataPath) !== appDataPath) throw new TypeError('Native folder grants require canonical absolute appData.');
	const libraryRoot = join(appDataPath, 'Lightscaper', 'project-library', 'v1');
	return Object.freeze({ libraryRoot, databasePath: join(libraryRoot, 'native-photo-linked-grants.sqlite3') });
}
export function initializeLightscaperNativePhotoLinkedGrantDatabaseCurrentV1(db: DatabaseSync, binding: LinkedGrantNamespaceCurrentV1): void {
	if (db.isTransaction) throw new Error('Native folder-grant initialization refuses an active transaction.');
	db.exec('PRAGMA foreign_keys=ON'); if (pragma(db, 'foreign_keys') !== 1) throw new Error('Native folder grants require foreign keys.');
	db.exec('BEGIN IMMEDIATE');
	try {
		if (inspectLightscaperNativePhotoLinkedGrantDatabaseCurrentV1(db, binding) === 'empty') {
			db.exec(OWNER); db.exec(SCHEMA);
			db.prepare('INSERT INTO native_photo_linked_grant_owner(singleton,media_path,media_device,media_inode) VALUES(1,?,?,?)').run(JSON.stringify(binding.path), binding.device, binding.inode); db.exec(`PRAGMA application_id=${APPLICATION}`); db.exec(`PRAGMA user_version=${VERSION}`);
		}
		if (inspectLightscaperNativePhotoLinkedGrantDatabaseCurrentV1(db, binding) !== 'owned') throw new Error('Native folder-grant schema was not admitted.');
		db.exec('COMMIT');
	} catch (primary) {
		try { if (db.isTransaction) db.exec('ROLLBACK'); } catch (failure) { throw cleanup([primary, failure], 'Native folder-grant schema rollback failed.'); }
		throw primary;
	}
}
export function inspectLightscaperNativePhotoLinkedGrantDatabaseCurrentV1(db: DatabaseSync, binding: LinkedGrantNamespaceCurrentV1): 'empty' | 'owned' {
	const application = pragma(db, 'application_id'), version = pragma(db, 'user_version');
	const rows = db.prepare("SELECT type,CASE WHEN length(CAST(name AS BLOB))<=256 THEN name END AS name,CASE WHEN length(CAST(sql AS BLOB))<=2048 THEN sql END AS sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name LIMIT 3").all(), owner = rows[0], row = rows[1];
	if (application === 0 && version === 0 && rows.length === 0) return 'empty';
	if (application !== APPLICATION || version !== VERSION || rows.length !== 2 || owner?.type !== 'table' || owner.name !== 'native_photo_linked_grant_owner' || owner.sql !== OWNER || row?.type !== 'table' || row.name !== TABLE || row.sql !== SCHEMA) throw new Error('Native folder-grant database has an unknown identity or schema.');
	readLinkedGrantNamespaceCurrentV1(db, binding); return 'owned';
}
function pragma(db: DatabaseSync, name: 'application_id' | 'user_version' | 'foreign_keys'): number {
	const value = db.prepare(`PRAGMA ${name}`).get()?.[name]; if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Invalid native grant SQLite identity.'); return value;
}
