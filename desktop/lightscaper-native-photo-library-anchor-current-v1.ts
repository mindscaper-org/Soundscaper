/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import type { KeyValueEntry, KeyValueWriteAdmission } from '../src/common/editor/storage/key-value-repository.ts';
import { canonicalKeyValueComparison as canonical } from '../src/common/editor/storage/key-value-canonical-comparison.ts';
import { captureLightscaperNativePhotoSettingCurrentV1 as capture, decodeLightscaperNativePhotoSettingCurrentV1 as decode } from './lightscaper-native-photo-settings-codec-current-v1.ts';
import { encodeLightscaperNativePhotoSettingKeyCurrentV1 as encodeKey } from './lightscaper-native-photo-settings-request-current-v1.ts';

const POINTER = 'photo-library:native-selected-v1', ACTIVE = 'photo-library:native-restore-active-v1';
const PREFIX = 'photo-library:native-restore-commit-v1:', MAXIMUM = 4096;
export interface LightscaperNativePhotoLibraryAnchorPairCurrentV1 {
	readonly expected: string; readonly payload: Uint8Array; readonly historyKey: Uint8Array; readonly history: Uint8Array;
	readonly pointerCanonical: string; readonly historyCanonical: string; readonly admission: KeyValueWriteAdmission | undefined;
}
export function readLightscaperNativePhotoLibraryAnchorKeyCurrentV1(value: unknown): Uint8Array {
	if (typeof value !== 'string' || value !== POINTER && value !== ACTIVE && !(value.startsWith(PREFIX) && /^[a-f0-9]{32}$/u.test(value.slice(PREFIX.length)))) {
		throw new TypeError('Native library authority requires its fixed anchor key.');
	}
	return encodeKey(value);
}
/** A corrupt generic settings value at an authority key must not be decoded
 * before its fixed encoded bound. Physical absence is independent of value. */
export function readLightscaperNativePhotoLibraryAnchorEntryCurrentV1(database: DatabaseSync, key: Uint8Array): KeyValueEntry {
	const row = database.prepare(`SELECT length(payload) AS payload_bytes,
		CASE WHEN typeof(payload)='blob' AND length(payload)<=4096 THEN payload END AS payload
		FROM native_photo_settings WHERE scope='anchor' AND key=?`).get(key);
	if (!row) return Object.freeze({ present: false });
	if (typeof row.payload_bytes !== 'number' || !Number.isSafeInteger(row.payload_bytes) || row.payload_bytes < 0) throw new TypeError('Native library authority payload is malformed.');
	if (row.payload_bytes > MAXIMUM) throw new RangeError('Native library authority exceeds its encoded byte bound.');
	if (!(row.payload instanceof Uint8Array) || row.payload.byteLength !== row.payload_bytes) throw new TypeError('Native library authority payload is not an owned BLOB.');
	return Object.freeze({ present: true, value: decode(row.payload) });
}
export async function captureLightscaperNativePhotoLibraryAnchorPairCurrentV1(expected: unknown, pointer: unknown, historyKey: unknown,
	history: unknown, admission?: KeyValueWriteAdmission): Promise<Readonly<LightscaperNativePhotoLibraryAnchorPairCurrentV1>> {
	if (typeof historyKey !== 'string' || !historyKey.startsWith(PREFIX)) throw new TypeError('Native library publication requires its distinct permanent history key.');
	const key = readLightscaperNativePhotoLibraryAnchorKeyCurrentV1(historyKey);
	if (admission !== undefined && typeof admission !== 'function') throw new TypeError('Native library publication admission must be callable.');
	const previous = canonical(expected), captures = [capture(pointer), capture(history)] as const;
	let payload: Uint8Array, historyPayload: Uint8Array;
	try { [payload, historyPayload] = await Promise.all(captures); }
	catch (primary) { await Promise.allSettled(captures); throw primary; }
	if (payload.byteLength > MAXIMUM || historyPayload.byteLength > MAXIMUM) throw new RangeError('Native library publication exceeds its encoded authority bound.');
	return Object.freeze({ expected: previous, payload, historyKey: key, history: historyPayload,
		pointerCanonical: canonical(decode(payload)), historyCanonical: canonical(decode(historyPayload)), admission });
}
/** Main-private ready admission is synchronous, repeated only after predicates
 * match. Both intended rows are authenticated while the same write transaction
 * still owns them, before the irreversible successful COMMIT acknowledgment. */
export function publishLightscaperNativePhotoLibraryAnchorPairCurrentV1(database: DatabaseSync, request: Readonly<LightscaperNativePhotoLibraryAnchorPairCurrentV1>): boolean {
	if (database.isTransaction) throw new Error('Native library publication requires its own transaction.');
	const admit = request.admission; admit?.(true); const key = encodeKey(POINTER);
	database.exec('BEGIN IMMEDIATE');
	try {
		const previous = readLightscaperNativePhotoLibraryAnchorEntryCurrentV1(database, key);
		const occupied = database.prepare("SELECT 1 FROM native_photo_settings WHERE scope='anchor' AND key=?").get(request.historyKey);
		if (!previous.present || canonical(previous.value) !== request.expected || occupied !== undefined) { database.exec('COMMIT'); return false; }
		admit?.(true);
		database.prepare("UPDATE native_photo_settings SET payload=? WHERE scope='anchor' AND key=?").run(request.payload, key);
		database.prepare("INSERT INTO native_photo_settings(scope,key,payload) VALUES('anchor',?,?)").run(request.historyKey, request.history);
		const pointer = readLightscaperNativePhotoLibraryAnchorEntryCurrentV1(database, key), history = readLightscaperNativePhotoLibraryAnchorEntryCurrentV1(database, request.historyKey);
		if (!pointer.present || canonical(pointer.value) !== request.pointerCanonical || !history.present || canonical(history.value) !== request.historyCanonical) {
			throw new Error('Native library publication stored pair does not match its intended authority.');
		}
		database.exec('COMMIT'); return true;
	} catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native library publication and rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}
