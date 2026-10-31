/* SPDX-License-Identifier: AGPL-3.0-only */
import { LIGHTSCAPER_NATIVE_PHOTO_MEDIA_IDENTITY_JOIN_CURRENT_V1 as IDENTITY_JOIN, LIGHTSCAPER_NATIVE_PHOTO_MEDIA_IDENTITY_COLUMNS_CURRENT_V1 as IDENTITY_COLUMNS } from './lightscaper-native-photo-media-identity-current-v1.ts';
import type { DatabaseSync } from 'node:sqlite';
import { binaryDerivativeManifestV1, normalizeBinaryDerivativeCacheIdentityV1,
	type BinaryDerivativeCacheIdentityV1 as Identity, type BinaryDerivativeCacheProfileV1 as Profile } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import { isMediaContentSha256, isMediaContentToken } from '../src/common/editor/storage/media-content-provenance.ts';
import { LIGHTSCAPER_NATIVE_PHOTO_PREVIEW_CHUNK_CURRENT_V1 as CHUNK } from './lightscaper-native-photo-preview-cache-database-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
export interface LightscaperNativePreviewEntryCurrentV1 {
	readonly identity: Identity; readonly manifest: string; readonly token: string; readonly bodyToken: string; readonly size: number; readonly mime: string; readonly committedAt: number; readonly outputSha256: string;
}
const failures = new WeakSet<object>();
export function lightscaperNativePhotoPreviewCleanupFailureCurrentV1(value: unknown): boolean { return value !== null && typeof value === 'object' && failures.has(value); }
export function lightscaperNativePhotoPreviewCleanupErrorCurrentV1(primary: unknown, cleanup: unknown): AggregateError {
	const error = new AggregateError([primary, cleanup], 'Native preview work and rollback failed.', { cause: cleanup }); failures.add(error); return error;
}
/** The only source projection: bounded asset/binding scalars, never metadata. */
export function lightscaperNativePhotoPreviewSourceCurrentV1(db: DatabaseSync, identity: Identity): string | null {
	const row = db.prepare(`SELECT CASE WHEN typeof(a.sha256)='text' AND length(CAST(a.sha256 AS BLOB))=64 THEN a.sha256 END AS sha,
		CASE WHEN length(CAST(a.media_content_token AS BLOB))<=142 THEN a.media_content_token END AS token,a.size,
		${IDENTITY_COLUMNS}
		FROM native_photo_media_assets a ${IDENTITY_JOIN} WHERE a.source_id=?`).get(identity.sourceId);
	return row && isMediaContentToken(row.token) && row.sha === identity.originalSha256 && row.size === identity.originalByteLength
		&& (row.identity_kind === 'managed' || row.identity_kind === 'linked') ? row.token : null;
}
export function readLightscaperNativePhotoPreviewEntryCurrentV1(db: DatabaseSync, key: string, profile?: Profile): LightscaperNativePreviewEntryCurrentV1 | null {
	const row = db.prepare(`SELECT CASE WHEN length(CAST(e.manifest AS BLOB))<=4096 THEN e.manifest END AS manifest,
		CASE WHEN length(CAST(e.source_token AS BLOB))<=142 THEN e.source_token END AS source_token,
		CASE WHEN length(CAST(e.output_sha256 AS BLOB))=64 THEN e.output_sha256 END AS output_sha256,
		CASE WHEN length(CAST(e.body_token AS BLOB))=32 THEN e.body_token END AS body_token,e.byte_length,
		CASE WHEN length(CAST(e.mime_type AS BLOB))<=256 THEN e.mime_type END AS mime_type,e.committed_at,b.byte_length AS body_length,b.chunk_count
		FROM native_photo_preview_entries e LEFT JOIN native_photo_preview_bodies b ON b.token=e.body_token WHERE e.key=?`).get(key);
	if (!row) return null;
	if (typeof row.manifest !== 'string' || !isMediaContentToken(row.source_token) || !isMediaContentSha256(row.output_sha256)
		|| typeof row.body_token !== 'string' || !/^[a-f0-9]{32}$/u.test(row.body_token) || typeof row.mime_type !== 'string'
		|| typeof row.committed_at !== 'number' || !Number.isSafeInteger(row.committed_at) || row.committed_at < 0) throw new TypeError('Native preview entry is malformed.');
	const identity = normalizeBinaryDerivativeCacheIdentityV1(JSON.parse(row.manifest) as unknown, profile);
	if (identity.key !== key || binaryDerivativeManifestV1(identity) !== row.manifest || row.byte_length !== identity.byteLength
		|| row.body_length !== identity.byteLength || row.chunk_count !== Math.ceil(identity.byteLength / CHUNK)) throw new Error('Native preview entry/body projection differs.');
	return Object.freeze({ identity, manifest: row.manifest, token: row.source_token, bodyToken: row.body_token,
		size: identity.byteLength, mime: row.mime_type, committedAt: row.committed_at, outputSha256: row.output_sha256 });
}
export function readLightscaperNativePhotoPreviewChunkCurrentV1(db: DatabaseSync, token: string, position: number, expected: number): Uint8Array {
	const row = db.prepare(`SELECT length(body) AS bytes,CASE WHEN typeof(body)='blob' AND length(body)<=1048576 THEN body END AS body
		FROM native_photo_preview_chunks WHERE body_token=? AND position=?`).get(token, position);
	if (!row || !(row.body instanceof Uint8Array) || row.bytes !== expected || row.body.byteLength !== expected) throw new Error('Native preview chunk is missing or malformed.');
	return row.body;
}
export function lightscaperNativePhotoPreviewTransactionCurrentV1<T>(db: DatabaseSync, signal: AbortSignal | undefined, run: () => T): T {
	if (db.isTransaction) throw new Error('Native preview requires ownership of its transaction.'); check(signal); db.exec('BEGIN IMMEDIATE');
	try { const result = run(); check(signal); db.exec('COMMIT'); return result; }
	catch (primary) {
		try { if (db.isTransaction) db.exec('ROLLBACK'); }
		catch (cleanup) { throw lightscaperNativePhotoPreviewCleanupErrorCurrentV1(primary, cleanup); } throw primary;
	}
}
export function discardLightscaperNativePhotoPreviewStagingCurrentV1(db: DatabaseSync, expected?: string): void {
	lightscaperNativePhotoPreviewTransactionCurrentV1(db, undefined, () => {
		const row = db.prepare('SELECT CASE WHEN length(CAST(body_token AS BLOB))=32 THEN body_token END AS token FROM native_photo_preview_staging WHERE singleton=1').get();
		if (!row) { if (expected && db.prepare('SELECT 1 FROM native_photo_preview_bodies WHERE token=?').get(expected)) throw new Error('Native preview staging authority disappeared.'); return; }
		if (expected !== undefined && row.token !== expected) throw new Error('Native preview cleanup cannot retire a different stage.');
		if (typeof row.token !== 'string' || !/^[a-f0-9]{32}$/u.test(row.token) || db.prepare('SELECT 1 FROM native_photo_preview_entries WHERE body_token=?').get(row.token)) throw new Error('Native preview staging ownership is inconsistent.');
		db.prepare('DELETE FROM native_photo_preview_staging WHERE singleton=1').run(); db.prepare('DELETE FROM native_photo_preview_bodies WHERE token=?').run(row.token);
		if (db.prepare('SELECT 1 FROM native_photo_preview_staging WHERE singleton=1').get() || db.prepare('SELECT 1 FROM native_photo_preview_bodies WHERE token=?').get(row.token)) throw new Error('Native preview staging retirement was incomplete.');
	});
}
