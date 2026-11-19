/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { isMediaContentToken } from '../src/common/editor/storage/media-content-provenance.ts';
import { PENDING_SOURCE_RETENTION_MS } from '../src/common/editor/storage/source-write-common.ts';
import { field, record } from '../src/lightscaper/catalog/value-validation.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { encodeLightscaperNativePhotoSettingKeyCurrentV1 as key } from './lightscaper-native-photo-settings-request-current-v1.ts';
import { decodeLightscaperNativePhotoSettingCurrentV1 as decode } from './lightscaper-native-photo-settings-codec-current-v1.ts';

const NativeDate = Date, PARSE = Date.parse, ISO = Date.prototype.toISOString, FILL = Uint8Array.prototype.fill;

/** Expected bytes are captured from this stage's own acknowledged preset row.
 * The bound and BLOB selection belong to the SAME native SQLite statement; a
 * later connection write cannot turn a prior length check into unbounded IO.
 * No arbitrary preset grammar or generic Settings value limit is introduced. */
export function readLightscaperNativePhotoMediaRestorePresetPayloadCurrentV1(database: DatabaseSync, catalogId: string,
	expectedBytes: number | null): Readonly<{ present: false }> | Readonly<{ present: true; value: unknown }> {
	if (expectedBytes !== null && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1)) throw new TypeError('Native restore requires its captured preset byte count.');
	const row = database.prepare(`SELECT length(payload) AS bytes,
		CASE WHEN typeof(payload)='blob' AND length(payload)=? THEN payload END AS payload
		FROM native_photo_settings WHERE scope=? AND key=?`).get(expectedBytes, 'selected:library', key(photoDevelopPresetsKeyV1(catalogId)));
	if (!row) { if (expectedBytes !== null) throw new Error('Native restored preset row is missing.'); return Object.freeze({ present: false }); }
	if (row.bytes !== expectedBytes || !(row.payload instanceof Uint8Array) || row.payload.byteLength !== expectedBytes) throw new Error('Native restored preset payload changed before bounded decode.');
	try { return Object.freeze({ present: true, value: decode(row.payload) }); }
	finally { Reflect.apply(FILL, row.payload, [0]); }
}

/** This fixed restore subset was generated only from bounded Original name,
 * MIME and native scalar defaults. Atomic CASE selection bounds the actual
 * metadata BLOB before the owning codec can receive or deserialize it. */
export function readLightscaperNativePhotoMediaRestoreMetadataCurrentV1(database: DatabaseSync, original: Readonly<PhotoOriginalV1>): Record<string, unknown> {
	const row = database.prepare(`SELECT CASE WHEN length(source_id)<=128 THEN source_id END AS source_id,
		CASE WHEN length(sha256)=64 THEN sha256 END AS sha256,size,
		CASE WHEN length(media_content_token)<=142 THEN media_content_token END AS media_content_token,
		length(metadata) AS metadata_bytes,CASE WHEN typeof(metadata)='blob' AND length(metadata)<=65536 THEN metadata END AS metadata,
		root_count,CASE WHEN length(committed_at)<=24 THEN committed_at END AS committed_at,
		CASE WHEN length(pending_until)<=24 THEN pending_until END AS pending_until
		FROM native_photo_media_assets WHERE source_id=?`).get(original.storageKey);
	const payload = row?.metadata;
	try {
		if (!row || row.source_id !== original.storageKey || row.sha256 !== original.contentSha256 || row.size !== original.byteLength
			|| !isMediaContentToken(row.media_content_token) || typeof row.root_count !== 'number' || !Number.isSafeInteger(row.root_count) || row.root_count < 1
			|| !(row.metadata instanceof Uint8Array) || row.metadata_bytes !== row.metadata.byteLength || row.metadata.byteLength < 1 || row.metadata.byteLength > 65536
			|| !timestamp(row.committed_at) || !timestamp(row.pending_until) || PARSE(row.pending_until) - PARSE(row.committed_at) !== PENDING_SOURCE_RETENTION_MS) {
			throw new TypeError('Native restored bounded asset metadata is malformed.');
		}
		const value = record(decode(row.metadata), 'native restore descriptive metadata', ['name', 'mimeType', 'lastModified']);
		const name = field(value, 'name'), mimeType = field(value, 'mimeType'), lastModified = field(value, 'lastModified');
		if (typeof name !== 'string' || typeof mimeType !== 'string' || lastModified !== 0) throw new TypeError('Native restore descriptive metadata differs from its generated subset.');
		const binding = database.prepare('SELECT CASE WHEN length(content_sha256)=64 THEN content_sha256 END AS sha256,byte_length AS size FROM native_photo_original_bindings WHERE storage_key=?').get(original.storageKey);
		if (!binding || binding.sha256 !== original.contentSha256 || binding.size !== original.byteLength) throw new Error('Native restored asset lost its actual immutable binding.');
		return { name, mimeType, lastModified, sourceId: original.storageKey, sha256: original.contentSha256, size: original.byteLength,
			storage: 'native-photo-original', committedAt: row.committed_at, pendingProjectUntil: row.pending_until };
	} finally { if (payload instanceof Uint8Array) Reflect.apply(FILL, payload, [0]); }
}
function timestamp(value: unknown): value is string {
	return typeof value === 'string' && Number.isFinite(PARSE(value)) && Reflect.apply(ISO, new NativeDate(value), []) === value;
}
