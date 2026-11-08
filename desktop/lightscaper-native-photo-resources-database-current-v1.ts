/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export const LIGHTSCAPER_NATIVE_PHOTO_RESOURCE_APPLICATION_ID_CURRENT_V1 = 0x4c535243;
const VERSION = 1;
const TABLE = 'native_photo_resources';
const SCHEMA = `CREATE TABLE ${TABLE} (
	storage_key TEXT PRIMARY KEY NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 128 AND storage_key NOT GLOB '*[^a-z0-9:-]*'),
	family TEXT NOT NULL CHECK (family IN ('lut','brush')),
	reference TEXT NOT NULL CHECK (length(CAST(reference AS BLOB)) BETWEEN 2 AND 2048 AND json_valid(reference) AND reference = json(reference)),
	body BLOB NOT NULL CHECK (length(body) BETWEEN 1 AND CASE family WHEN 'lut' THEN 16777216 ELSE 1048592 END),
	CHECK ((family = 'lut' AND substr(storage_key,1,11) = 'lut-sha256:') OR (family = 'brush' AND substr(storage_key,1,14) = 'brush-mask-v1:'))
) STRICT`;

export interface LightscaperNativePhotoResourcePathsCurrentV1 { readonly libraryRoot: string; readonly databasePath: string }
/** Only the host's canonical private appData selects a directory. Neither a
 * renderer path, resource key nor descriptor can become a physical filename. */
export function deriveLightscaperNativePhotoResourcePathsCurrentV1(appDataPath: string): Readonly<LightscaperNativePhotoResourcePathsCurrentV1> {
	if (typeof appDataPath !== 'string' || appDataPath.includes('\0') || !isAbsolute(appDataPath) || resolve(appDataPath) !== appDataPath) {
		throw new TypeError('Native Photo resources require canonical absolute appData.');
	}
	const libraryRoot = join(appDataPath, 'Lightscaper', 'project-library', 'v1');
	return Object.freeze({ libraryRoot, databasePath: join(libraryRoot, 'native-photo-resources.sqlite3') });
}

/** Physical schema admission only. The body owner authenticates full canonical
 * references and actual LUT/SCMASK01 bytes before publication and delivery.
 * This connection and its close remain owned by the composing resource store. */
export function initializeLightscaperNativePhotoResourceDatabaseCurrentV1(database: DatabaseSync): void {
	if (database.isTransaction) throw new Error('Native Photo resource initialization requires no active transaction.');
	database.exec('PRAGMA foreign_keys=ON');
	if (pragma(database, 'foreign_keys') !== 1) throw new Error('Native Photo resource foreign keys must be enforced.');
	database.exec('BEGIN IMMEDIATE');
	try {
		if (inspectLightscaperNativePhotoResourceDatabaseCurrentV1(database) === 'empty') {
			database.exec(SCHEMA);
			database.exec(`PRAGMA application_id=${LIGHTSCAPER_NATIVE_PHOTO_RESOURCE_APPLICATION_ID_CURRENT_V1}`);
			database.exec(`PRAGMA user_version=${VERSION}`);
		}
		if (inspectLightscaperNativePhotoResourceDatabaseCurrentV1(database) !== 'owned') throw new Error('Native Photo resource initialization did not publish its exact owned schema.');
		database.exec('COMMIT');
	} catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native resource initialization and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
/** Fixed read-only preflight authority; no PRAGMA writes, schema repair or body
 * loads. An empty database may be initialized by the subsequent writable owner. */
export function inspectLightscaperNativePhotoResourceDatabaseCurrentV1(database: DatabaseSync): 'empty' | 'owned' {
	const application = pragma(database, 'application_id'), version = pragma(database, 'user_version'), owned = objects(database), table = owned[0];
	if (application === 0 && version === 0 && owned.length === 0) return 'empty';
	if (application !== LIGHTSCAPER_NATIVE_PHOTO_RESOURCE_APPLICATION_ID_CURRENT_V1 || version !== VERSION) throw new Error('Native Photo resource database is unowned or has an unsupported identity.');
	if (owned.length !== 1 || !table || table.type !== 'table' || table.name !== TABLE || table.sql !== SCHEMA) throw new Error('Native Photo resource schema differs from its exact owned version.');
	return 'owned';
}
function pragma(database: DatabaseSync, name: 'application_id' | 'user_version' | 'foreign_keys'): number {
	const value = database.prepare(`PRAGMA ${name}`).get()?.[name];
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Native Photo resource SQLite identity is invalid.');
	return value;
}
function objects(database: DatabaseSync) {
	// GLOB treats underscore literally; sqliteXforeign remains user-owned.
	return database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
}
