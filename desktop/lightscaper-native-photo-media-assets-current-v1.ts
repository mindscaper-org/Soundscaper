/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertLightscaperNativePhotoOriginalUnpinnedCurrentV1 } from './lightscaper-native-photo-original-read-pins-current-v1.ts';
import { ensureLightscaperNativeManagedPhotoMediaIdentityCurrentV1 as ensureManagedIdentity,
	assertLightscaperNativeManagedPhotoMediaIdentityCurrentV1 as assertManagedIdentity } from './lightscaper-native-photo-media-identity-current-v1.ts';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { isMediaContentSha256, isMediaContentToken } from '../src/common/editor/storage/media-content-provenance.ts';
import { PENDING_SOURCE_RETENTION_MS } from '../src/common/editor/storage/source-write-common.ts';
import { decodeLightscaperNativePhotoSettingCurrentV1 } from './lightscaper-native-photo-settings-codec-current-v1.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1 as MAXIMUM,
	readLightscaperNativeOriginalStorageKeyCurrentV1 as readKey } from './lightscaper-native-original-contract-current-v1.ts';
import { consumeLightscaperNativeOriginalPublicationCurrentV1 } from './lightscaper-native-original-store-current-v1.ts';
import { readLightscaperNativePhotoMediaWriteCurrentV1, type LightscaperNativePhotoMediaWriteCurrentV1 } from './lightscaper-native-photo-media-blob-current-v1.ts';
import { LIGHTSCAPER_NATIVE_PHOTO_MEDIA_RESERVED_METADATA_CURRENT_V1 as RESERVED, readLightscaperNativePhotoMediaMetadataCurrentV1,
	type LightscaperNativePhotoMediaMetadataCurrentV1 } from './lightscaper-native-photo-media-metadata-current-v1.ts';
import { readLightscaperNativeOriginalBindingCurrentV1, type LightscaperNativeOriginalBindingCurrentV1 as Binding } from './lightscaper-native-original-index-current-v1.ts';

const COLUMNS = 'source_id,sha256,size,media_content_token,metadata,root_count,committed_at,pending_until';
export const LIGHTSCAPER_NATIVE_PHOTO_SESSION_METADATA_FRAME_MAXIMUM_BYTES_CURRENT_V1 = 134_217_728;
const CHECK = AbortSignal.prototype.throwIfAborted;
const NativeDate = Date, PARSE = Date.parse, ISO = Date.prototype.toISOString, TIME = Date.prototype.getTime;
type Row = Readonly<{ binding: Readonly<Binding>; token: string; payload: Uint8Array; count: number;
	committedAt: string; pendingUntil: string; descriptive: Record<string, unknown> }>;

/** Genuine file materialization precedes this short single-database authority
 * transaction. A failed SQL publication may leave a safe unadvertised body. */
export function installLightscaperNativePhotoMediaAssetCurrentV1(database: DatabaseSync,
	value: LightscaperNativePhotoMediaWriteCurrentV1, proof: unknown, signal?: AbortSignal): Record<string, unknown> {
	assertIdle(database); check(signal);
	const captured = readLightscaperNativePhotoMediaWriteCurrentV1(value), expected = captured.binding;
	if (!expected) throw new TypeError('Native Photo asset publication requires its actual completed Blob digest.');
	return installCaptured(database, captured.assetId, captured.metadataPayload, expected, proof, signal);
}

/** A genuine completed stream uses the same publication transaction as Blob
 * writes. Expected length/SHA originate with the owning writer admission; the
 * actual physical proof and stored binding must independently match them. */
export function installLightscaperNativePhotoMediaStreamAssetCurrentV1(database: DatabaseSync,
	value: LightscaperNativePhotoMediaMetadataCurrentV1, expectedPhysicalBinding: unknown, proof: unknown, signal?: AbortSignal): Record<string, unknown> {
	assertIdle(database); check(signal);
	const captured = readLightscaperNativePhotoMediaMetadataCurrentV1(value), expected = readLightscaperNativeOriginalBindingCurrentV1(expectedPhysicalBinding);
	return installCaptured(database, captured.assetId, captured.metadataPayload, expected, proof, signal);
}

function installCaptured(database: DatabaseSync, assetId: string, metadataPayload: Uint8Array,
	expected: Readonly<Binding>, proof: unknown, signal?: AbortSignal): Record<string, unknown> {
	if (expected.storageKey !== assetId) throw new Error('Native Photo metadata capture and physical asset identity disagree.');
	const descriptive = readMetadata(metadataPayload);
	const now = new NativeDate(), committedAt = Reflect.apply(ISO, now, []) as string;
	const pendingUntil = Reflect.apply(ISO, new NativeDate(Number(Reflect.apply(TIME, now, [])) + PENDING_SOURCE_RETENTION_MS), []) as string;
	return transaction(database, signal, () => {
		const binding = consumeLightscaperNativeOriginalPublicationCurrentV1(proof, database);
		if (!same(binding, expected)) throw new Error('Native Photo asset capture and physical publication disagree.');
		assertBinding(database, binding);
		if (database.prepare('SELECT 1 FROM native_photo_media_assets WHERE source_id=?').get(binding.storageKey)) {
			throw new Error('Immutable native Photo media asset cannot be overwritten.');
		}
		ensureManagedIdentity(database, binding);
		const token = `media-content-${randomUUID()}`;
		database.prepare(`INSERT INTO native_photo_media_assets(${COLUMNS}) VALUES(?,?,?,?,?,?,?,?)`)
			.run(binding.storageKey, binding.contentSha256, binding.byteLength, token, metadataPayload, 0, committedAt, pendingUntil);
		const stored = read(database, binding.storageKey);
		if (!stored || !same(stored.binding, binding) || stored.token !== token || stored.count !== 0
			|| stored.committedAt !== committedAt || stored.pendingUntil !== pendingUntil || !equalBytes(stored.payload, metadataPayload)) {
			throw new Error('Native Photo asset publication changed before acknowledgment.');
		}
		return receipt({ ...stored, descriptive });
	});
}

export function getLightscaperNativePhotoMediaAssetCurrentV1(database: DatabaseSync, assetId: string): Record<string, unknown> | null {
	assertIdle(database); const row = read(database, readKey(assetId)); return row ? receipt(row) : null;
}

/** Main transport has one read lane and this fixed atomic frame ceiling.
 * Existing generic metadata storage/grammar and reads remain unchanged. */
export function getLightscaperNativePhotoSessionMediaMetadataCurrentV1(database: DatabaseSync, assetId: string): Record<string, unknown> | null {
	assertIdle(database); const row = read(database, readKey(assetId), LIGHTSCAPER_NATIVE_PHOTO_SESSION_METADATA_FRAME_MAXIMUM_BYTES_CURRENT_V1);
	return row ? receipt(row) : null;
}

/** Logical retirement is atomic with the real Original binding. Immutable SHA
 * files remain untouched: another binding or reader can still own that body. */
export function deleteLightscaperNativePhotoMediaAssetCurrentV1(database: DatabaseSync, assetId: string, signal?: AbortSignal): void {
	assertIdle(database); const key = readKey(assetId); assertLightscaperNativePhotoOriginalUnpinnedCurrentV1(database, key);
	transaction(database, signal, () => {
		const row = read(database, key); if (!row) return;
		if (row.count !== 0 || database.prepare('SELECT 1 FROM native_photo_media_roots WHERE asset_id=? LIMIT 1').get(key)) {
			throw new Error('Native Photo media is retained by a catalog Original root.');
		}
		database.prepare('DELETE FROM native_photo_media_assets WHERE source_id=?').run(key);
		database.prepare('DELETE FROM native_photo_media_identities WHERE source_id=?').run(key);
		database.prepare('DELETE FROM native_photo_original_bindings WHERE storage_key=?').run(key);
		if (database.prepare('SELECT 1 FROM native_photo_media_assets WHERE source_id=?').get(key)
			|| database.prepare('SELECT 1 FROM native_photo_media_identities WHERE source_id=?').get(key)
			|| database.prepare('SELECT 1 FROM native_photo_original_bindings WHERE storage_key=?').get(key)) {
			throw new Error('Native Photo media asset and Original binding retirement was not complete.');
		}
	});
}

function read(database: DatabaseSync, key: string, maximumFrameBytes?: number): Row | null {
	const row = maximumFrameBytes === undefined ? database.prepare(`SELECT ${COLUMNS} FROM native_photo_media_assets WHERE source_id=?`).get(key)
		: database.prepare(`SELECT
			CASE WHEN typeof(source_id)='text' AND length(CAST(source_id AS BLOB)) BETWEEN 1 AND 128 THEN source_id END AS source_id,
			CASE WHEN typeof(sha256)='text' AND length(CAST(sha256 AS BLOB))=64 THEN sha256 END AS sha256,size,
			CASE WHEN typeof(media_content_token)='text' AND length(CAST(media_content_token AS BLOB))<=142 THEN media_content_token END AS media_content_token,
			typeof(metadata) AS metadata_type,length(metadata) AS metadata_bytes,
			CASE WHEN typeof(metadata)='blob' AND length(metadata)<=? THEN metadata END AS metadata,root_count,
			CASE WHEN typeof(committed_at)='text' AND length(CAST(committed_at AS BLOB))<=32 THEN committed_at END AS committed_at,
			CASE WHEN typeof(pending_until)='text' AND length(CAST(pending_until AS BLOB))<=32 THEN pending_until END AS pending_until
			FROM native_photo_media_assets WHERE source_id=?`).get(maximumFrameBytes, key);
	if (!row) return null;
	if (maximumFrameBytes !== undefined) {
		if (row.metadata_type !== 'blob' || typeof row.metadata_bytes !== 'number' || !Number.isSafeInteger(row.metadata_bytes) || row.metadata_bytes < 0) throw new TypeError('Native Session metadata is not an owned BLOB.');
		if (row.metadata_bytes > maximumFrameBytes) throw new RangeError('Native Session metadata exceeds its encoded frame bound.');
	}
	if (readKey(row.source_id) !== key || !isMediaContentSha256(row.sha256) || typeof row.size !== 'number'
		|| !Number.isSafeInteger(row.size) || row.size < 1 || row.size > MAXIMUM || !isMediaContentToken(row.media_content_token)
		|| !(row.metadata instanceof Uint8Array) || typeof row.root_count !== 'number' || !Number.isSafeInteger(row.root_count) || row.root_count < 0
		|| !timestamp(row.committed_at) || !timestamp(row.pending_until)
		|| PARSE(row.pending_until) - PARSE(row.committed_at) !== PENDING_SOURCE_RETENTION_MS) {
		throw new TypeError('Native Photo media asset metadata is malformed.');
	}
	const binding = Object.freeze({ storageKey: key, byteLength: row.size, contentSha256: row.sha256 }); assertBinding(database, binding); assertManagedIdentity(database, binding);
	return { binding, token: row.media_content_token, payload: row.metadata, count: row.root_count,
		committedAt: row.committed_at, pendingUntil: row.pending_until, descriptive: readMetadata(row.metadata) };
}

function assertBinding(database: DatabaseSync, binding: Readonly<Binding>): void {
	const row = database.prepare(`SELECT CASE WHEN typeof(storage_key)='text' AND length(CAST(storage_key AS BLOB)) BETWEEN 1 AND 128 THEN storage_key END AS storage_key,
		CASE WHEN typeof(content_sha256)='text' AND length(CAST(content_sha256 AS BLOB))=64 THEN content_sha256 END AS content_sha256,byte_length
		FROM native_photo_original_bindings WHERE storage_key=?`).get(binding.storageKey);
	if (!row || row.storage_key !== binding.storageKey || row.content_sha256 !== binding.contentSha256 || row.byte_length !== binding.byteLength) {
		throw new Error('Native Photo asset has no matching immutable Original binding.');
	}
}
function readMetadata(payload: Uint8Array): Record<string, unknown> {
	const value = decodeLightscaperNativePhotoSettingCurrentV1(payload);
	if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Native Photo descriptive metadata is malformed.');
	const data = value as Record<string, unknown>;
	if (typeof data.name !== 'string' || typeof data.mimeType !== 'string' || typeof data.lastModified !== 'number'
		|| !Number.isFinite(data.lastModified) || data.lastModified < 0 || Math.floor(data.lastModified) !== data.lastModified
		|| RESERVED.some(key => key !== 'mimeType' && Object.hasOwn(data, key))) throw new TypeError('Native Photo descriptive metadata carries invalid reserved authority.');
	return data;
}
function receipt(row: Row): Record<string, unknown> {
	return { ...row.descriptive, sourceId: row.binding.storageKey, sha256: row.binding.contentSha256, size: row.binding.byteLength,
		storage: 'native-photo-original', committedAt: row.committedAt, pendingProjectUntil: row.pendingUntil };
}
function timestamp(value: unknown): value is string {
	if (typeof value !== 'string' || !Number.isFinite(PARSE(value))) return false;
	return Reflect.apply(ISO, new NativeDate(value), []) === value;
}
function same(left: Readonly<Binding>, right: Readonly<Binding>): boolean {
	return left.storageKey === right.storageKey && left.byteLength === right.byteLength && left.contentSha256 === right.contentSha256;
}
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
function assertIdle(database: DatabaseSync): void { if (database.isTransaction) throw new Error('Native Photo assets require their own transaction.'); }
function transaction<Result>(database: DatabaseSync, signal: AbortSignal | undefined, run: () => Result): Result {
	assertIdle(database); check(signal); database.exec('BEGIN IMMEDIATE');
	try { const result = run(); check(signal); database.exec('COMMIT'); return result; }
	catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Photo asset operation and rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}
