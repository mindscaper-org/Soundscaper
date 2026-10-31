/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { canonicalKeyValueComparison } from '../src/common/editor/storage/key-value-canonical-comparison.ts';
import type { KeyValueEntry } from '../src/common/editor/storage/key-value-repository.ts';
import { decodeLightscaperNativePhotoSettingCurrentV1 } from './lightscaper-native-photo-settings-codec-current-v1.ts';
import type { LightscaperNativePhotoSettingsRequestCurrentV1 as Request } from './lightscaper-native-photo-settings-request-current-v1.ts';

function read(database: DatabaseSync, scope: string, key: Uint8Array): KeyValueEntry {
	const row = database.prepare('SELECT payload FROM native_photo_settings WHERE scope=? AND key=?').get(scope, key);
	if (!row) return Object.freeze({ present: false });
	if (!(row.payload instanceof Uint8Array)) throw new TypeError('Native Photo setting payload is not a BLOB.');
	return Object.freeze({ present: true, value: decodeLightscaperNativePhotoSettingCurrentV1(row.payload) });
}
function write(database: DatabaseSync, scope: string, key: Uint8Array, payload: Uint8Array): void {
	database.prepare('INSERT INTO native_photo_settings(scope,key,payload) VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET payload=excluded.payload').run(scope, key, payload);
}
function matches(entry: KeyValueEntry, expected: string): boolean {
	return entry.present && canonicalKeyValueComparison(entry.value) === expected;
}
function present(database: DatabaseSync, scope: string, key: Uint8Array): boolean {
	return database.prepare('SELECT 1 FROM native_photo_settings WHERE scope=? AND key=?').get(scope, key) !== undefined;
}

/** Every mutation owns a real immediate transaction. Parser/clone work is
 * already joined; a durable COMMIT acknowledgment has no later close check. */
export function executeLightscaperNativePhotoSettingsRequestCurrentV1(database: DatabaseSync, scope: string, request: Request, beforeCommit?: () => void): unknown {
	// A failed ROLLBACK can leave uncommitted state on the private connection.
	// Neither reads nor later mutations may publish that failed transaction.
	if (database.isTransaction) throw new Error('Native Photo settings require ownership of their transaction.');
	if (request.method === 'get' || request.method === 'readEntry') {
		const entry = read(database, scope, request.key);
		return request.method === 'get' ? entry.present ? entry.value : undefined : entry;
	}
	// Trusted synchronous admission belongs to the restore domain. Invoke
	// it once before conditions, then only for the exact matched two-write path.
	const admission = request.method === 'replaceIfCurrentAndPutIfAbsent' ? request.admission : undefined;
	admission?.(true);
	const receipt = request.method === 'put' ? decodeLightscaperNativePhotoSettingCurrentV1(request.payload) : undefined;
	database.exec('BEGIN IMMEDIATE');
	try {
		let result: unknown;
		switch (request.method) {
			case 'delete':
				database.prepare('DELETE FROM native_photo_settings WHERE scope=? AND key=?').run(scope, request.key);
				break;
			case 'put': write(database, scope, request.key, request.payload); result = receipt; break;
			case 'putIfAbsent':
				result = !present(database, scope, request.key);
				if (result) write(database, scope, request.key, request.payload);
				break;
			case 'replaceIfCurrent':
			case 'deleteIfCurrent':
				result = matches(read(database, scope, request.key), request.expected);
				if (result && request.method === 'replaceIfCurrent') write(database, scope, request.key, request.payload);
				else if (result) database.prepare('DELETE FROM native_photo_settings WHERE scope=? AND key=?').run(scope, request.key);
				break;
			case 'replaceIfCurrentAndPutIfAbsent':
				result = matches(read(database, scope, request.key), request.expected) && !present(database, scope, request.intentKey);
				if (result) {
					admission?.(true);
					write(database, scope, request.key, request.payload);
					write(database, scope, request.intentKey, request.intentPayload);
				}
				break;
		}
		beforeCommit?.();
		database.exec('COMMIT');
		return result;
	} catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Photo settings mutation and rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}
