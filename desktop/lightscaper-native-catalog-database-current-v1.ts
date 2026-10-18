/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../src/lightscaper/catalog/types.ts';
import { PHOTO_CATALOG_REPOSITORY_LIMITS } from '../src/lightscaper/catalog/repository-types.ts';
import { withProjectLibraryImmediateTransaction } from './project-library-immediate-transaction.ts';
import { LIGHTSCAPER_NATIVE_QUERY_SCHEMA_CURRENT_V1 } from './lightscaper-native-query-schema-current-v1.ts';
import { LIGHTSCAPER_NATIVE_STACK_SCHEMA_CURRENT_V1 } from './lightscaper-native-stack-schema-current-v1.ts';
import { LIGHTSCAPER_NATIVE_LEGACY_QUERY_SCHEMA_CURRENT_V1 } from './lightscaper-native-legacy-query-schema-current-v1.ts';
import { LIGHTSCAPER_NATIVE_SMART_COLLECTION_SCHEMA_CURRENT_V1 } from './lightscaper-native-smart-collection-schema-current-v1.ts';
export { readLightscaperNativeCatalogRowCurrentV1, readLightscaperNativePhotoRowCurrentV1, readLightscaperNativeSummaryRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
export type { LightscaperNativeCatalogSnapshotCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';

export const LIGHTSCAPER_NATIVE_CATALOG_APPLICATION_ID_CURRENT_V1 = 0x4c534343;
const VERSION = 5;
const SAFE = Number.MAX_SAFE_INTEGER;
const DOCUMENT_BYTES = LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes;
const SUMMARY_BYTES = PHOTO_CATALOG_REPOSITORY_LIMITS.maximumSummaryBytes;
const stable = (column: string) => `length(${column}) BETWEEN 1 AND 128 AND ${column} GLOB '[A-Za-z0-9]*' AND ${column} NOT GLOB '*[^A-Za-z0-9._:-]*'`;
const SCHEMA = Object.freeze([
	{ type: 'table', name: 'native_photo_catalogs', sql: `CREATE TABLE native_photo_catalogs (
	id TEXT PRIMARY KEY NOT NULL CHECK (${stable('id')}),
	document TEXT NOT NULL CHECK (length(CAST(document AS BLOB)) BETWEEN 1 AND ${DOCUMENT_BYTES}),
	root_revision INTEGER NOT NULL CHECK (root_revision BETWEEN 0 AND ${SAFE}),
	photo_count INTEGER NOT NULL CHECK (photo_count BETWEEN 0 AND ${LIGHTSCAPER_CATALOG_LIMITS.maximumPhotos}),
	index_revision INTEGER NOT NULL CHECK (index_revision BETWEEN 0 AND ${SAFE})
) STRICT` },
	{ type: 'table', name: 'native_photos', sql: `CREATE TABLE native_photos (
	photo_key TEXT PRIMARY KEY NOT NULL,
	catalog_id TEXT NOT NULL CHECK (${stable('catalog_id')}) REFERENCES native_photo_catalogs(id) ON DELETE CASCADE,
	photo_id TEXT NOT NULL CHECK (${stable('photo_id')}),
	revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND ${SAFE}),
	document TEXT NOT NULL CHECK (length(CAST(document AS BLOB)) BETWEEN 1 AND ${DOCUMENT_BYTES}),
	summary TEXT NOT NULL CHECK (length(CAST(summary AS BLOB)) BETWEEN 1 AND ${SUMMARY_BYTES}),
	CHECK (photo_key = catalog_id || '|' || photo_id),
	UNIQUE (catalog_id, photo_key)
) STRICT` },
	{ type: 'table', name: 'native_photo_memberships', sql: `CREATE TABLE native_photo_memberships (
	key TEXT PRIMARY KEY NOT NULL CHECK (length(key) BETWEEN 1 AND 512),
	scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 384 AND scope NOT GLOB '*[^A-Za-z0-9._:|-]*'),
	photo_key TEXT NOT NULL,
	catalog_id TEXT NOT NULL CHECK (${stable('catalog_id')}),
	CHECK (substr(scope, 1, length(catalog_id) + 1) = catalog_id || '|'),
	CHECK (key = scope || substr(photo_key, length(catalog_id) + 1)),
	FOREIGN KEY (catalog_id, photo_key) REFERENCES native_photos(catalog_id, photo_key) ON DELETE CASCADE
) STRICT` },
	{ type: 'index', name: 'native_photos_catalog_key', sql: 'CREATE INDEX native_photos_catalog_key ON native_photos(catalog_id, photo_key)' },
	{ type: 'index', name: 'native_photo_memberships_scope_key', sql: 'CREATE INDEX native_photo_memberships_scope_key ON native_photo_memberships(scope, key)' },
	{ type: 'index', name: 'native_photo_memberships_photo_key', sql: 'CREATE INDEX native_photo_memberships_photo_key ON native_photo_memberships(photo_key)' },
]);

export interface LightscaperNativeCatalogPathsCurrentV1 { readonly libraryRoot: string; readonly databasePath: string }
export function deriveLightscaperNativeCatalogPathsCurrentV1(appDataRoot: string): Readonly<LightscaperNativeCatalogPathsCurrentV1> {
	if (typeof appDataRoot !== 'string' || appDataRoot.includes('\0') || !isAbsolute(appDataRoot)) throw new TypeError('Native Photo catalog requires an absolute appData root.');
	const libraryRoot = resolve(appDataRoot, 'Lightscaper', 'project-library', 'v1');
	return Object.freeze({ libraryRoot, databasePath: join(libraryRoot, 'native-photo-catalogs.sqlite3') });
}

/** Root owns secure file admission and connection close. This initializer only
 * adopts an empty database or verifies this exact independent native schema. */
export function initializeLightscaperNativeCatalogDatabaseCurrentV1(database: DatabaseSync): void {
	if (database.isTransaction) throw new Error('Native Photo schema initialization requires no active transaction.');
	database.exec('PRAGMA foreign_keys = ON');
	if (pragma(database, 'foreign_keys') !== 1) throw new Error('Native Photo catalog foreign keys must be enforced.');
	withProjectLibraryImmediateTransaction(database, () => {
		const application = pragma(database, 'application_id'), version = pragma(database, 'user_version');
		const querySchema = [...SCHEMA, ...LIGHTSCAPER_NATIVE_QUERY_SCHEMA_CURRENT_V1];
		const stackSchema = [...querySchema, ...LIGHTSCAPER_NATIVE_STACK_SCHEMA_CURRENT_V1];
		const legacySchema = [...stackSchema, ...LIGHTSCAPER_NATIVE_LEGACY_QUERY_SCHEMA_CURRENT_V1];
		const currentSchema = [...legacySchema, ...LIGHTSCAPER_NATIVE_SMART_COLLECTION_SCHEMA_CURRENT_V1];
		if (application === 0 && version === 0 && schema(database).length === 0) {
			for (const entry of currentSchema) database.exec(entry.sql);
			database.exec(`PRAGMA application_id = ${LIGHTSCAPER_NATIVE_CATALOG_APPLICATION_ID_CURRENT_V1}`);
			database.exec(`PRAGMA user_version = ${VERSION}`);
		} else if (application === LIGHTSCAPER_NATIVE_CATALOG_APPLICATION_ID_CURRENT_V1 && (version === 1 || version === 2 || version === 3 || version === 4)) {
			assertSchema(database, version === 1 ? SCHEMA : version === 2 ? querySchema : version === 3 ? stackSchema : legacySchema);
			if (version === 1) {
				for (const entry of LIGHTSCAPER_NATIVE_QUERY_SCHEMA_CURRENT_V1) database.exec(entry.sql);
				// Project metadata later through the bounded Query2 rebuild owner.
				database.exec('INSERT INTO native_photo_query_builds_v2(catalog_id,ready,after_key,indexed_count) SELECT id,0,NULL,0 FROM native_photo_catalogs');
			}
			if (version < 3) {
				for (const entry of LIGHTSCAPER_NATIVE_STACK_SCHEMA_CURRENT_V1) database.exec(entry.sql);
				// Preserve existing catalog/Photo/query bytes and initialize grouping only.
				database.exec('INSERT INTO native_photo_stack_states(catalog_id,revision,stack_count) SELECT id,0,0 FROM native_photo_catalogs');
			}
			if (version < 4) {
				for (const entry of LIGHTSCAPER_NATIVE_LEGACY_QUERY_SCHEMA_CURRENT_V1) database.exec(entry.sql);
				// Legacy projection remains independent bounded rebuild work.
				database.exec('INSERT INTO native_photo_query_builds_v1(catalog_id,ready,after_key,indexed_count) SELECT id,0,NULL,0 FROM native_photo_catalogs');
			}
			for (const entry of LIGHTSCAPER_NATIVE_SMART_COLLECTION_SCHEMA_CURRENT_V1) database.exec(entry.sql);
			// No saved-state backfill: absent, persisted empty and tombstone states
			// remain distinct through migration, open and ordinary catalog creation.
			database.exec(`PRAGMA user_version = ${VERSION}`);
		} else if (application !== LIGHTSCAPER_NATIVE_CATALOG_APPLICATION_ID_CURRENT_V1 || version !== VERSION) {
			throw new Error('Native Photo catalog database is unowned or has an unsupported identity.');
		}
		assertSchema(database, currentSchema);
	});
}
function assertSchema(database: DatabaseSync, expected: readonly Readonly<{ type: string; name: string; sql: string }>[]): void {
	const actual = schema(database);
	if (actual.length !== expected.length || actual.some(row => !expected.some(entry =>
		row.name === entry.name && row.type === entry.type && row.sql === entry.sql))) {
		throw new Error('Native Photo catalog schema differs from its exact owned version.');
	}
}

function schema(database: DatabaseSync) {
	// GLOB keeps the underscore literal; sqliteXforeign is user-owned data.
	return database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
}
function pragma(database: DatabaseSync, name: 'application_id' | 'user_version' | 'foreign_keys'): number {
	const value = database.prepare(`PRAGMA ${name}`).get()?.[name];
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Native Photo catalog SQLite identity is invalid.');
	return value;
}
