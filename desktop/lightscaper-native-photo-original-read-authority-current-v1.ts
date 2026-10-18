/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { catalogOriginalId, catalogOriginalKey, catalogOriginalScope, normalizeCatalogOriginalRoot,
	CATALOG_ORIGINAL_ROOT_MAX_BYTES } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { isMediaContentSha256, isMediaContentToken } from '../src/common/editor/storage/media-content-provenance.ts';
import { readLightscaperNativeOriginalCurrentV1 } from './lightscaper-native-original-contract-current-v1.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';

export interface LightscaperNativePhotoOriginalReadRequestCurrentV1 {
	readonly catalogId: string; readonly photoId: string; readonly original: Readonly<PhotoOriginalV1>; readonly importId: string | null;
}
export interface LightscaperNativePhotoOriginalReadAuthorityCurrentV1 {
	readonly storageKey: string; readonly contentSha256: string; readonly byteLength: number; readonly token: string;
}
export function captureLightscaperNativePhotoOriginalReadRequestCurrentV1(value: unknown): Readonly<LightscaperNativePhotoOriginalReadRequestCurrentV1> {
	const input = record(value, 'native Original read request', ['catalogId', 'photoId', 'original', 'importId']);
	const imported = field(input, 'importId', 'native Original read request');
	return Object.freeze({ catalogId: catalogOriginalId(field(input, 'catalogId', 'native Original read request')),
		photoId: catalogOriginalId(field(input, 'photoId', 'native Original read request')),
		original: readLightscaperNativeOriginalCurrentV1(field(input, 'original', 'native Original read request')),
		importId: imported === null ? null : catalogOriginalId(imported) });
}
/** One bounded scalar snapshot. No metadata BLOB, body read, whole inventory or
	* callback participates in this transaction. Staged-to-permanent is allowed. */
export function readLightscaperNativePhotoOriginalAuthorityCurrentV1(database: DatabaseSync,
	request: LightscaperNativePhotoOriginalReadRequestCurrentV1, importId: string | null,
	expected?: LightscaperNativePhotoOriginalReadAuthorityCurrentV1): Readonly<LightscaperNativePhotoOriginalReadAuthorityCurrentV1> {
	if (database.isTransaction) throw new Error('Native Original authorization requires no active transaction.');
	database.exec('BEGIN');
	try {
		const row = database.prepare(`SELECT a.source_id,CASE WHEN typeof(a.sha256)='text' AND length(CAST(a.sha256 AS BLOB))=64 THEN a.sha256 END AS sha256,a.size,
			CASE WHEN typeof(a.media_content_token)='text' AND length(CAST(a.media_content_token AS BLOB))<=256 THEN a.media_content_token END AS media_content_token,a.root_count,
			b.storage_key AS binding_key,CASE WHEN typeof(b.content_sha256)='text' AND length(CAST(b.content_sha256 AS BLOB))=64 THEN b.content_sha256 END AS binding_sha,b.byte_length AS binding_size
			FROM native_photo_media_assets a LEFT JOIN native_photo_original_bindings b ON b.storage_key=a.source_id WHERE a.source_id=?`).get(request.original.storageKey);
		if (!row || row.source_id !== request.original.storageKey || !isMediaContentSha256(row.sha256) || row.sha256 !== request.original.contentSha256
			|| row.size !== request.original.byteLength || !isMediaContentToken(row.media_content_token) || typeof row.root_count !== 'number'
			|| !Number.isSafeInteger(row.root_count) || row.root_count < 1 || row.binding_key !== row.source_id || row.binding_sha !== row.sha256 || row.binding_size !== row.size) {
			throw new Error('Native Original lacks matching retained media provenance.');
		}
		const authority = Object.freeze({ storageKey: request.original.storageKey, contentSha256: row.sha256, byteLength: request.original.byteLength, token: row.media_content_token });
		if (expected && (authority.storageKey !== expected.storageKey || authority.contentSha256 !== expected.contentSha256
			|| authority.byteLength !== expected.byteLength || authority.token !== expected.token)) throw new Error('The native Original asset generation changed.');
		let retained = root(database, request, null, authority);
		if (!retained && importId !== null) retained = root(database, request, catalogOriginalId(importId), authority);
		if (!retained) throw new Error('Native Original lacks permanent or current-import custody.');
		database.exec('COMMIT'); return authority;
	} catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Original authorization and rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}
function root(database: DatabaseSync, request: LightscaperNativePhotoOriginalReadRequestCurrentV1, importId: string | null,
	authority: LightscaperNativePhotoOriginalReadAuthorityCurrentV1): boolean {
	const key = catalogOriginalKey(request.catalogId, importId, request.photoId);
	const row = database.prepare(`SELECT CASE WHEN length(root_key)<=4096 THEN root_key END AS root_key,
		CASE WHEN length(scope_key)<=4096 THEN scope_key END AS scope_key,
		CASE WHEN typeof(asset_id)='text' AND length(CAST(asset_id AS BLOB))<=2048 THEN asset_id END AS asset_id,
		CASE WHEN typeof(root)='text' AND length(CAST(root AS BLOB))<=2048 THEN root END AS root FROM native_photo_media_roots WHERE root_key=?`).get(utf16(key));
	if (!row) return false;
	if (typeof row.root !== 'string' || Buffer.byteLength(row.root, 'utf8') > CATALOG_ORIGINAL_ROOT_MAX_BYTES) throw new Error('Native Original custody exceeds its bounded profile.');
	const parsed: unknown = JSON.parse(row.root), value = normalizeCatalogOriginalRoot(parsed);
	if (JSON.stringify(value) !== row.root || !same(row.root_key, utf16(key)) || value.key !== key
		|| !same(row.scope_key, utf16(catalogOriginalScope(request.catalogId, importId))) || row.asset_id !== authority.storageKey
		|| value.catalogId !== request.catalogId || value.importId !== importId || value.photoId !== request.photoId
		|| value.assetId !== authority.storageKey || value.sourceId !== request.original.id || value.sha256 !== authority.contentSha256
		|| value.size !== authority.byteLength || value.mediaContentToken !== authority.token) throw new Error('Native Original custody differs from its stored Photo or media generation.');
	return true;
}
function utf16(value: string): Uint8Array {
	const result = new Uint8Array(value.length * 2);
	for (let index = 0; index < value.length; index++) { const unit = value.charCodeAt(index); result[index * 2] = unit >>> 8; result[index * 2 + 1] = unit & 255; }
	return result;
}
function same(value: unknown, expected: Uint8Array): boolean { return value instanceof Uint8Array && value.byteLength === expected.byteLength && value.every((byte, index) => byte === expected[index]); }
