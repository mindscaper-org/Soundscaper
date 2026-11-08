/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const APPLICATION = 0x4c534e53;
const OWNER = `CREATE TABLE native_photo_library_scope_owner (
	singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
	owner_token TEXT NOT NULL CHECK (length(owner_token) = 32 AND length(CAST(owner_token AS BLOB)) = 32 AND owner_token NOT GLOB '*[^0-9a-f]*')
) STRICT`;
const SCOPES = `CREATE TABLE native_photo_library_scopes (
	namespace_token TEXT PRIMARY KEY NOT NULL CHECK (length(namespace_token) = 32 AND length(CAST(namespace_token AS BLOB)) = 32 AND namespace_token NOT GLOB '*[^0-9a-f]*'),
	allocation TEXT NOT NULL CHECK (length(CAST(allocation AS BLOB)) BETWEEN 2 AND 2048 AND json_valid(allocation) AND allocation = json(allocation) AND json_extract(allocation,'$.namespaceToken') = namespace_token),
	manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64 AND length(CAST(manifest_sha256 AS BLOB)) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
	state TEXT NOT NULL CHECK (state IN ('reserved','created'))
) STRICT`;
const EXPECTED = [{ type: 'table', name: 'native_photo_library_scope_owner', sql: OWNER }, { type: 'table', name: 'native_photo_library_scopes', sql: SCOPES }];

export function initializeLightscaperNativePhotoLibraryScopeDatabaseCurrentV1(database: DatabaseSync): void {
	if (database.isTransaction) throw new Error('Native library registry initialization requires no active transaction.');
	database.exec('PRAGMA foreign_keys=ON');
	if (pragma(database, 'foreign_keys') !== 1) throw new Error('Native library registry requires foreign keys.');
	database.exec('BEGIN IMMEDIATE');
	try {
		if (inspectLightscaperNativePhotoLibraryScopeDatabaseCurrentV1(database) === 'empty') {
			database.exec(OWNER); database.exec(SCOPES);
			database.prepare('INSERT INTO native_photo_library_scope_owner(singleton,owner_token) VALUES(1,?)').run(randomBytes(16).toString('hex'));
			database.exec(`PRAGMA application_id=${APPLICATION}`); database.exec('PRAGMA user_version=1');
		}
		if (inspectLightscaperNativePhotoLibraryScopeDatabaseCurrentV1(database) !== 'owned') throw new Error('Native library registry identity publication failed.');
		database.exec('COMMIT');
	} catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native library registry initialization and rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}

/** Bounded read-only ownership preflight. Scalar owner identity is required;
 * an emptied or foreign registry never gains a replacement root owner. */
export function inspectLightscaperNativePhotoLibraryScopeDatabaseCurrentV1(database: DatabaseSync): 'empty' | 'owned' {
	const application = pragma(database, 'application_id'), version = pragma(database, 'user_version');
	const rows = database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name LIMIT 3").all();
	if (application === 0 && version === 0 && rows.length === 0) return 'empty';
	if (application !== APPLICATION || version !== 1 || rows.length !== EXPECTED.length || rows.some((row, index) => {
		const expected = EXPECTED[index]; return !expected || row.type !== expected.type || row.name !== expected.name || row.sql !== expected.sql;
	})) throw new Error('Native library registry differs from its exact owned schema.');
	readLightscaperNativePhotoLibraryRootOwnerCurrentV1(database); return 'owned';
}
export function readLightscaperNativePhotoLibraryRootOwnerCurrentV1(database: DatabaseSync): string {
	const rows = database.prepare('SELECT singleton,owner_token FROM native_photo_library_scope_owner LIMIT 2').all(), owner = rows[0];
	if (rows.length !== 1 || !owner || owner.singleton !== 1 || typeof owner.owner_token !== 'string' || !/^[a-f0-9]{32}$/u.test(owner.owner_token)) {
		throw new Error('Native library registry has no exact root owner.');
	}
	return owner.owner_token;
}
function pragma(database: DatabaseSync, name: 'application_id' | 'user_version' | 'foreign_keys'): number {
	const value = database.prepare(`PRAGMA ${name}`).get()?.[name];
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Native library registry SQLite identity is invalid.');
	return value;
}
