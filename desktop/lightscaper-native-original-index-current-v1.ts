/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { withProjectLibraryImmediateTransaction } from './project-library-immediate-transaction.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1,
	readLightscaperNativeOriginalCurrentV1, readLightscaperNativeOriginalStorageKeyCurrentV1,
} from './lightscaper-native-original-contract-current-v1.ts';

export const LIGHTSCAPER_NATIVE_PHOTO_ORIGINAL_APPLICATION_ID_CURRENT_V1 = 0x4c534350;
const SCHEMA_VERSION = 1;
const TABLE = 'native_photo_original_bindings';
const SHA256 = /^[a-f0-9]{64}$/u;
const SCHEMA = `CREATE TABLE ${TABLE} (
	storage_key TEXT PRIMARY KEY NOT NULL CHECK (
		length(storage_key) BETWEEN 1 AND 128 AND storage_key GLOB '[A-Za-z0-9]*'
		AND storage_key NOT GLOB '*[^A-Za-z0-9._:-]*'
	),
	content_sha256 TEXT NOT NULL CHECK (
		length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'
	),
	byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND ${LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1})
) STRICT`;

export interface LightscaperNativePhotoOriginalPathsCurrentV1 {
	readonly libraryRoot: string; readonly databasePath: string;
	readonly bodiesRoot: string; readonly stagingRoot: string;
}
/** A physical body binding. Per-photo IDs, names, dimensions and MIME belong
 * to the catalog: digest deduplication can share one key across those aliases. */
export interface LightscaperNativeOriginalBindingCurrentV1 {
	readonly storageKey: string; readonly byteLength: number; readonly contentSha256: string;
}

export function deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataRoot: string): Readonly<LightscaperNativePhotoOriginalPathsCurrentV1> {
	if (typeof appDataRoot !== 'string' || appDataRoot.includes('\0') || !isAbsolute(appDataRoot)) {
		throw new TypeError('Native Lightscaper Originals require an absolute appData root.');
	}
	const libraryRoot = resolve(appDataRoot, 'Lightscaper', 'project-library', 'v1');
	return Object.freeze({ libraryRoot, databasePath: join(libraryRoot, 'native-photo-originals.sqlite3'),
		bodiesRoot: join(libraryRoot, 'native-photo-originals'), stagingRoot: join(libraryRoot, 'native-photo-originals-staging') });
}

/** Paths remain main-private. Only a declared digest, never a storage key or
 * renderer file name, selects the immutable body's sharded physical path. */
export function lightscaperNativePhotoOriginalBodyPathCurrentV1(paths: Readonly<LightscaperNativePhotoOriginalPathsCurrentV1>, sha256: string): string {
	if (typeof sha256 !== 'string' || !SHA256.test(sha256)) throw new TypeError('Native Original body path requires a lowercase SHA-256.');
	return join(paths.bodiesRoot, sha256.slice(0, 2), `${sha256}.body`);
}

/** The database owner must secure/open the fixed native path and close it only
 * after its operations join. This index performs no file I/O or body proof. */
export class LightscaperNativePhotoOriginalIndexCurrentV1 {
	readonly #database: DatabaseSync;
	constructor(database: DatabaseSync) {
		this.#database = database;
		withProjectLibraryImmediateTransaction(database, () => {
			const application = pragma(database, 'application_id'), version = pragma(database, 'user_version');
			const objects = ownedObjects(database);
			if (application === 0 && version === 0 && objects.length === 0) {
				database.exec(SCHEMA);
				database.exec(`PRAGMA application_id = ${LIGHTSCAPER_NATIVE_PHOTO_ORIGINAL_APPLICATION_ID_CURRENT_V1}`);
				database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
			} else if (application !== LIGHTSCAPER_NATIVE_PHOTO_ORIGINAL_APPLICATION_ID_CURRENT_V1 || version !== SCHEMA_VERSION) {
				throw new Error('Native Lightscaper Original database is unowned or has an unsupported identity.');
			}
			// A known application id alone cannot bless foreign tables, triggers,
			// adjacent schema or weakened constraints in this single-purpose file.
			const current = ownedObjects(database), first = current[0];
			if (current.length !== 1 || !first || first.name !== TABLE || first.type !== 'table' || first.sql !== SCHEMA) {
				throw new Error('Native Lightscaper Original database schema differs from its exact owned version.');
			}
		});
		Object.freeze(this);
	}

	get(storageKeyValue: unknown): Readonly<LightscaperNativeOriginalBindingCurrentV1> | null {
		const storageKey = readLightscaperNativeOriginalStorageKeyCurrentV1(storageKeyValue);
		const row = this.#database.prepare(`SELECT storage_key, content_sha256, byte_length FROM ${TABLE} WHERE storage_key = ?`).get(storageKey);
		if (row === undefined) return null;
		const binding = readBinding(row.storage_key, row.byte_length, row.content_sha256);
		if (binding.storageKey !== storageKey) throw new Error('Native Original stored key differs from the requested binding.');
		return binding;
	}

	/** Call only after the body owner authenticated/closed its actual file. The
	 * SQLite binding itself never claims the declared bytes exist or hash-match. */
	putIfAbsent(value: unknown): 'inserted' | 'same' {
		const original = readLightscaperNativeOriginalCurrentV1(value);
		const expected = readBinding(original.storageKey, original.byteLength, original.contentSha256);
		return withProjectLibraryImmediateTransaction<'inserted' | 'same'>(this.#database, () => {
			const current = this.get(expected.storageKey);
			if (current) {
				if (!sameBinding(current, expected)) throw new Error('Native Original storage key already binds different bytes.');
				return 'same';
			}
			this.#database.prepare(`INSERT INTO ${TABLE} (storage_key, content_sha256, byte_length) VALUES (?, ?, ?)`)
				.run(expected.storageKey, expected.contentSha256, expected.byteLength);
			const stored = this.get(expected.storageKey);
			if (!stored || !sameBinding(stored, expected)) throw new Error('Native Original saved physical binding differs from its admission.');
			return 'inserted';
		});
	}
}

function readBinding(storageKey: unknown, byteLength: unknown, contentSha256: unknown): Readonly<LightscaperNativeOriginalBindingCurrentV1> {
	const key = readLightscaperNativeOriginalStorageKeyCurrentV1(storageKey);
	if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 1
		|| byteLength > LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1 || typeof contentSha256 !== 'string' || !SHA256.test(contentSha256)) {
		throw new TypeError('Native Original physical binding has an invalid length or digest.');
	}
	return Object.freeze({ storageKey: key, byteLength, contentSha256 });
}
function sameBinding(left: Readonly<LightscaperNativeOriginalBindingCurrentV1>, right: Readonly<LightscaperNativeOriginalBindingCurrentV1>): boolean {
	return left.storageKey === right.storageKey && left.byteLength === right.byteLength && left.contentSha256 === right.contentSha256;
}
function pragma(database: DatabaseSync, name: 'application_id' | 'user_version'): number {
	const value = database.prepare(`PRAGMA ${name}`).get()?.[name];
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Native Original SQLite identity is invalid.');
	return value;
}
function ownedObjects(database: DatabaseSync) {
	return database.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name").all();
}
