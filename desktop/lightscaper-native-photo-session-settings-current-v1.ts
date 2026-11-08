/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import type { KeyValueEntry } from '../src/common/editor/storage/key-value-repository.ts';
import { desktopPhotoSessionSettingsKeyCurrentV1 as keyFor, desktopPhotoSessionSettingsMaximumEncodedBytesCurrentV1 as maximum,
	assertDesktopPhotoSessionSettingsValueCurrentV1 as validate } from '../src/lightscaper/desktop-photo-library-session-settings-current-v1.ts';
import { encodeLightscaperNativePhotoSettingKeyCurrentV1 } from './lightscaper-native-photo-settings-request-current-v1.ts';
import { decodeLightscaperNativePhotoSettingCurrentV1 } from './lightscaper-native-photo-settings-codec-current-v1.ts';

/** Exactly one fixed domain, atomic payload-size guard before native decode.
 * The raw decoded own-field order and occupied undefined are retained. */
export function readLightscaperNativePhotoSessionSettingEntryCurrentV1(db: DatabaseSync, scope: string, catalog: string, domain: unknown): KeyValueEntry {
	if (db.isTransaction) throw new Error('Native Session settings require their own bounded read.');
	const key = encodeLightscaperNativePhotoSettingKeyCurrentV1(keyFor(catalog, domain)), limit = maximum(domain);
	const row = db.prepare(`SELECT typeof(payload) AS payload_type,length(payload) AS payload_bytes,
		CASE WHEN typeof(payload)='blob' AND length(payload)<=? THEN payload END AS payload
		FROM native_photo_settings WHERE scope=? AND key=?`).get(limit, scope, key);
	if (!row) return Object.freeze({ present: false });
	if (row.payload_type !== 'blob' || typeof row.payload_bytes !== 'number' || !Number.isSafeInteger(row.payload_bytes) || row.payload_bytes < 0) throw new TypeError('Native Session setting is not an owned BLOB.');
	if (row.payload_bytes > limit) throw new RangeError('Native Session setting exceeds its encoded domain bound.');
	if (!(row.payload instanceof Uint8Array) || row.payload.byteLength !== row.payload_bytes) throw new TypeError('Native Session setting payload is malformed.');
	const value = decodeLightscaperNativePhotoSettingCurrentV1(row.payload);
	if (value !== undefined) validate(value, catalog, domain);
	return Object.freeze({ present: true, value });
}
