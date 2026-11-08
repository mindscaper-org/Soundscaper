/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export const LIGHTSCAPER_NATIVE_PHOTO_SETTINGS_APPLICATION_ID_CURRENT_V1 = 0x4c535354;
const VERSION = 1;
const TABLE = 'native_photo_settings';
const SCHEMA = `CREATE TABLE ${TABLE} (
	scope TEXT NOT NULL CHECK (length(CAST(scope AS BLOB)) = length(scope) AND (scope = 'anchor' OR (
		length(scope) BETWEEN 10 AND 137 AND substr(scope,1,9) = 'selected:'
		AND substr(scope,10,1) GLOB '[a-z0-9]' AND substr(scope,10) NOT GLOB '*[^a-z0-9._-]*'))),
	key BLOB NOT NULL CHECK (length(key) % 2 = 0),
	payload BLOB NOT NULL,
	PRIMARY KEY (scope,key)
) STRICT`;

export interface LightscaperNativePhotoSettingsPathsCurrentV1 { readonly libraryRoot: string; readonly databasePath: string }
/** Fixed host-private storage. Scope labels and key/value bytes can never
 * choose a physical filename or grant allocation/deletion authority. */
export function deriveLightscaperNativePhotoSettingsPathsCurrentV1(appDataPath: string): Readonly<LightscaperNativePhotoSettingsPathsCurrentV1> {
	if (typeof appDataPath !== 'string' || appDataPath.includes('\0') || !isAbsolute(appDataPath) || resolve(appDataPath) !== appDataPath) {
		throw new TypeError('Native Photo settings require canonical absolute appData.');
	}
	const libraryRoot = join(appDataPath, 'Lightscaper', 'project-library', 'v1');
	return Object.freeze({ libraryRoot, databasePath: join(libraryRoot, 'native-photo-settings.sqlite3') });
}

/** Physical custody only. The owning versioned codec authenticates values;
 * scope is a main-owned binding label, never a namespace ownership proof.
 * The composing settings owner joins accepted work before connection close. */
export function initializeLightscaperNativePhotoSettingsDatabaseCurrentV1(database: DatabaseSync): void {
	if (database.isTransaction) throw new Error('Native Photo settings initialization requires no active transaction.');
	database.exec('PRAGMA foreign_keys=ON');
	if (pragma(database, 'foreign_keys') !== 1) throw new Error('Native Photo settings foreign keys must be enforced.');
	database.exec('BEGIN IMMEDIATE');
	try {
		if (inspectLightscaperNativePhotoSettingsDatabaseCurrentV1(database) === 'empty') {
			database.exec(SCHEMA);
			database.exec(`PRAGMA application_id=${LIGHTSCAPER_NATIVE_PHOTO_SETTINGS_APPLICATION_ID_CURRENT_V1}`);
			database.exec(`PRAGMA user_version=${VERSION}`);
		}
		if (inspectLightscaperNativePhotoSettingsDatabaseCurrentV1(database) !== 'owned') throw new Error('Native Photo settings initialization did not publish its exact owned schema.');
		database.exec('COMMIT');
	} catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native settings initialization and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
/** Fixed read-only preflight: no repair, PRAGMA writes or value loads. An
 * empty database may be initialized by the subsequent writable owner. */
export function inspectLightscaperNativePhotoSettingsDatabaseCurrentV1(database: DatabaseSync): 'empty' | 'owned' {
	const application = pragma(database, 'application_id'), version = pragma(database, 'user_version'), owned = objects(database), table = owned[0];
	if (application === 0 && version === 0 && owned.length === 0) return 'empty';
	if (application !== LIGHTSCAPER_NATIVE_PHOTO_SETTINGS_APPLICATION_ID_CURRENT_V1 || version !== VERSION) throw new Error('Native Photo settings database is unowned or has an unsupported identity.');
	if (owned.length !== 1 || !table || table.type !== 'table' || table.name !== TABLE || table.sql !== SCHEMA) throw new Error('Native Photo settings schema differs from its exact owned version.');
	return 'owned';
}
function pragma(database: DatabaseSync, name: 'application_id' | 'user_version' | 'foreign_keys'): number {
	const value = database.prepare(`PRAGMA ${name}`).get()?.[name];
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Native Photo settings SQLite identity is invalid.');
	return value;
}
function objects(database: DatabaseSync) {
	// GLOB treats underscore literally; sqliteXforeign remains user-owned.
	return database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
}
