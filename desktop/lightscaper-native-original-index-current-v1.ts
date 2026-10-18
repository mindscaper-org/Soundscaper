/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { readClosedDomainField, readClosedDomainRecord } from '../src/common/editor/closed-domain-value.ts';
import { initializeLightscaperNativePhotoMediaDatabaseCurrentV1 } from './lightscaper-native-photo-media-schema-current-v1.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1,
	readLightscaperNativeOriginalCurrentV1, readLightscaperNativeOriginalStorageKeyCurrentV1,
} from './lightscaper-native-original-contract-current-v1.ts';

export const LIGHTSCAPER_NATIVE_PHOTO_ORIGINAL_APPLICATION_ID_CURRENT_V1 = 0x4c534350;
const TABLE = 'native_photo_original_bindings';
const SHA256 = /^[a-f0-9]{64}$/u;

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
		initializeLightscaperNativePhotoMediaDatabaseCurrentV1(database);
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
		return this.putBindingIfAbsent({ storageKey: original.storageKey, byteLength: original.byteLength, contentSha256: original.contentSha256 });
	}

	/** Physical publication needs no invented Photo dimensions or MIME. The
	 * composing file owner must authenticate the actual bytes before this call. */
	putBindingIfAbsent(value: unknown): 'inserted' | 'same' {
		const expected = readLightscaperNativeOriginalBindingCurrentV1(value);
		return bindingTransaction<'inserted' | 'same'>(this.#database, () => {
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

export function readLightscaperNativeOriginalBindingCurrentV1(value: unknown): Readonly<LightscaperNativeOriginalBindingCurrentV1> {
	const input = readClosedDomainRecord(value, 'native Original binding', ['storageKey', 'byteLength', 'contentSha256']);
	return readBinding(readClosedDomainField(input, 'storageKey', 'native Original binding'),
		readClosedDomainField(input, 'byteLength', 'native Original binding'), readClosedDomainField(input, 'contentSha256', 'native Original binding'));
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

function bindingTransaction<Result>(database: DatabaseSync, run: () => Result): Result {
	if (database.isTransaction) throw new Error('Native Original binding requires no active transaction.');
	database.exec('BEGIN IMMEDIATE');
	try { const result = run(); database.exec('COMMIT'); return result; }
	catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Original binding publication and rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}
