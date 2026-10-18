/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

const APPLICATION = 0x4c534350;
/** Resolved historical LSCP1 DDL. Changing these bytes would reject existing
 * owned Original stores; metadata migration never rewrites their bindings. */
const ORIGINAL = `CREATE TABLE native_photo_original_bindings (
	storage_key TEXT PRIMARY KEY NOT NULL CHECK (
		length(storage_key) BETWEEN 1 AND 128 AND storage_key GLOB '[A-Za-z0-9]*'
		AND storage_key NOT GLOB '*[^A-Za-z0-9._:-]*'
	),
	content_sha256 TEXT NOT NULL CHECK (
		length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'
	),
	byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 205520896)
) STRICT`;
const ASSETS = `CREATE TABLE native_photo_media_assets (
	source_id TEXT PRIMARY KEY NOT NULL REFERENCES native_photo_original_bindings(storage_key),
	sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND length(CAST(sha256 AS BLOB)) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
	size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 205520896),
	media_content_token TEXT NOT NULL CHECK (
		length(media_content_token) BETWEEN 30 AND 142 AND length(CAST(media_content_token AS BLOB)) = length(media_content_token)
		AND substr(media_content_token,1,14) = 'media-content-' AND substr(media_content_token,15,1) GLOB '[a-z0-9]'
		AND substr(media_content_token,15) NOT GLOB '*[^a-z0-9-]*'
	),
	metadata BLOB NOT NULL,
	root_count INTEGER NOT NULL CHECK (root_count BETWEEN 0 AND 9007199254740991),
	committed_at TEXT NOT NULL CHECK (length(committed_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ',committed_at) IS NOT NULL AND committed_at = strftime('%Y-%m-%dT%H:%M:%fZ',committed_at)),
	pending_until TEXT NOT NULL CHECK (length(pending_until) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ',pending_until) IS NOT NULL AND pending_until = strftime('%Y-%m-%dT%H:%M:%fZ',pending_until) AND pending_until > committed_at)
) STRICT`;
const ROOTS = `CREATE TABLE native_photo_media_roots (
	root_key BLOB PRIMARY KEY NOT NULL CHECK (length(root_key) BETWEEN 2 AND 4096 AND length(root_key) % 2 = 0),
	scope_key BLOB NOT NULL CHECK (length(scope_key) BETWEEN 2 AND 4096 AND length(scope_key) % 2 = 0),
	asset_id TEXT NOT NULL REFERENCES native_photo_media_assets(source_id),
	root TEXT NOT NULL CHECK (length(CAST(root AS BLOB)) BETWEEN 2 AND 2048 AND json_valid(root) AND root = json(root))
) STRICT`;
const INDEXES = [
	['native_photo_media_assets_digest', 'CREATE INDEX native_photo_media_assets_digest ON native_photo_media_assets(sha256,source_id)'],
	['native_photo_media_roots_asset', 'CREATE INDEX native_photo_media_roots_asset ON native_photo_media_roots(asset_id,root_key)'],
	['native_photo_media_roots_scope', 'CREATE INDEX native_photo_media_roots_scope ON native_photo_media_roots(scope_key,root_key)'],
] as const;
const MEDIA_V2 = [
	...INDEXES.map(([name, sql]) => ({ type: 'index', name, sql })),
	{ type: 'table', name: 'native_photo_media_assets', sql: ASSETS },
	{ type: 'table', name: 'native_photo_media_roots', sql: ROOTS },
	{ type: 'table', name: 'native_photo_original_bindings', sql: ORIGINAL },
];

const LOCATORS = `CREATE TABLE native_photo_original_body_locators (
	content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64 AND length(CAST(content_sha256 AS BLOB)) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
	locator_id TEXT NOT NULL CHECK (locator_id = 'legacy' OR (length(locator_id) = 64 AND length(CAST(locator_id AS BLOB)) = 64 AND locator_id NOT GLOB '*[^0-9a-f]*')),
	byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 205520896),
	layout TEXT NOT NULL CHECK ((locator_id = 'legacy' AND layout = 'legacy-sha-v1') OR (locator_id <> 'legacy' AND layout = 'generation-v1')),
	PRIMARY KEY(content_sha256,locator_id),
	UNIQUE(content_sha256,locator_id,byte_length)
) STRICT`;
const HEADS = `CREATE TABLE native_photo_original_body_heads (
	content_sha256 TEXT PRIMARY KEY NOT NULL CHECK (length(content_sha256) = 64 AND length(CAST(content_sha256 AS BLOB)) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
	locator_id TEXT NOT NULL CHECK (locator_id = 'legacy' OR (length(locator_id) = 64 AND length(CAST(locator_id AS BLOB)) = 64 AND locator_id NOT GLOB '*[^0-9a-f]*')),
	byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 205520896),
	revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
	FOREIGN KEY(content_sha256,locator_id,byte_length) REFERENCES native_photo_original_body_locators(content_sha256,locator_id,byte_length)
) STRICT`;
const BINDINGS_INDEX = 'CREATE INDEX native_photo_original_bindings_digest ON native_photo_original_bindings(content_sha256,byte_length,storage_key)';
const OWNED = [
	...INDEXES.map(([name, sql]) => ({ type: 'index', name, sql })),
	{ type: 'index', name: 'native_photo_original_bindings_digest', sql: BINDINGS_INDEX },
	...MEDIA_V2.filter(row => row.type === 'table'),
	{ type: 'table', name: 'native_photo_original_body_heads', sql: HEADS },
	{ type: 'table', name: 'native_photo_original_body_locators', sql: LOCATORS },
];

/** No provenance is inferred from a historical binding. Only authenticated
 * physical publication may create the new asset and custody rows later. */
export function initializeLightscaperNativePhotoMediaDatabaseCurrentV1(database: DatabaseSync): void {
	if (database.isTransaction) throw new Error('Native Photo media initialization requires no active transaction.');
	database.exec('PRAGMA foreign_keys=ON');
	if (pragma(database, 'foreign_keys') !== 1) throw new Error('Native Photo media requires enforced foreign keys.');
	database.exec('BEGIN IMMEDIATE');
	try {
		const current = inspectLightscaperNativePhotoMediaDatabaseCurrentV1(database);
		if (current !== 'owned') {
			if (current === 'empty') database.exec(ORIGINAL);
			if (current === 'empty' || current === 'original-v1') {
				database.exec(ASSETS); database.exec(ROOTS);
				for (const [, sql] of INDEXES) database.exec(sql);
			}
			database.exec(LOCATORS); database.exec(HEADS); database.exec(BINDINGS_INDEX);
			database.exec(`PRAGMA application_id=${APPLICATION}`); database.exec('PRAGMA user_version=3');
		}
		if (inspectLightscaperNativePhotoMediaDatabaseCurrentV1(database) !== 'owned') throw new Error('Native Photo media schema publication failed.');
		database.exec('COMMIT');
	} catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Photo media initialization and rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}

/** Bounded fixed identity preflight, valid on a read-only connection. No
 * original, metadata or custody values are loaded, repaired or authenticated. */
export function inspectLightscaperNativePhotoMediaDatabaseCurrentV1(database: DatabaseSync): 'empty' | 'original-v1' | 'media-v2' | 'owned' {
	const application = pragma(database, 'application_id'), version = pragma(database, 'user_version');
	const objects = database.prepare(`SELECT
		CASE WHEN typeof(type)='text' AND length(CAST(type AS BLOB))<=16 THEN type END AS type,
		CASE WHEN typeof(name)='text' AND length(CAST(name AS BLOB))<=128 THEN name END AS name,
		CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=8192 THEN sql END AS sql
		FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name LIMIT ${OWNED.length + 1}`).all();
	if (application === 0 && version === 0 && objects.length === 0) return 'empty';
	if (application !== APPLICATION || (version !== 1 && version !== 2 && version !== 3)) throw new Error('Native Photo media database has an unowned or unsupported identity.');
	const expected = version === 1 ? [{ type: 'table', name: 'native_photo_original_bindings', sql: ORIGINAL }] : version === 2 ? MEDIA_V2 : OWNED;
	if (objects.length !== expected.length || objects.some((row, index) => {
		const match = expected[index]; return !match || row.type !== match.type || row.name !== match.name || row.sql !== match.sql;
	})) throw new Error('Native Photo media schema differs from its exact owned version.');
	return version === 1 ? 'original-v1' : version === 2 ? 'media-v2' : 'owned';
}
function pragma(database: DatabaseSync, name: 'application_id' | 'user_version' | 'foreign_keys'): number {
	const value = database.prepare(`PRAGMA ${name}`).get()?.[name];
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Native Photo media SQLite identity is invalid.');
	return value;
}
