/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { catalogOriginalKey, catalogOriginalScope, normalizeCatalogOriginalRoot,
	CATALOG_ORIGINAL_PAGE_SIZE, CATALOG_ORIGINAL_ROOT_MAX_BYTES, type CatalogOriginalRootV1 } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import type { CatalogOriginalRepairBindingV1 } from '../src/common/editor/storage/media-catalog-original-repair-contract.ts';
import { isMediaContentSha256, isMediaContentToken } from '../src/common/editor/storage/media-content-provenance.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';

type Row = Record<string, SQLOutputValue>;
interface Asset { readonly key: string; readonly sha256: string; readonly size: number; readonly token: string; readonly count: number }
export interface LightscaperNativePhotoOriginalInspectionCustodyCurrentV1 {
	readonly root: Readonly<CatalogOriginalRootV1>;
	readonly asset: Readonly<Asset> | null;
	readonly count: number;
	readonly rootsSha256: string;
}
const ROOT_COLUMNS = `CASE WHEN typeof(root_key)='blob' AND length(root_key)<=4096 THEN root_key END AS root_key,
	CASE WHEN typeof(scope_key)='blob' AND length(scope_key)<=4096 THEN scope_key END AS scope_key,
	CASE WHEN typeof(asset_id)='text' AND length(CAST(asset_id AS BLOB))<=128 THEN asset_id END AS asset_id,
	CASE WHEN typeof(root)='text' AND length(CAST(root AS BLOB))<=2048 THEN root END AS root`;

/** Fixed scalar custody snapshot. Metadata is deliberately never selected.
 * Every alias is authenticated in bounded pages; no file work holds this tx. */
export function readLightscaperNativePhotoOriginalInspectionCustodyCurrentV1(database: DatabaseSync,
	binding: Readonly<CatalogOriginalRepairBindingV1>, signal?: AbortSignal): Readonly<LightscaperNativePhotoOriginalInspectionCustodyCurrentV1> {
	if (database.isTransaction) throw new Error('Native Original inspection requires no unsettled transaction.');
	check(signal); database.exec('BEGIN');
	try {
		const key = catalogOriginalKey(binding.catalogId, binding.importId, binding.photoId);
		const selected = database.prepare(`SELECT ${ROOT_COLUMNS} FROM native_photo_media_roots WHERE root_key=?`).get(utf16(key));
		if (!selected) throw new Error('The exact selected native catalog Original root is missing.');
		const root = readRoot(selected);
		if (root.key !== key || root.catalogId !== binding.catalogId || root.importId !== binding.importId || root.photoId !== binding.photoId
			|| root.assetId !== binding.assetId || root.sourceId !== binding.sourceId || root.sha256 !== binding.sha256 || root.size !== binding.size) {
			throw new Error('Selected native Original custody differs from its inspection binding.');
		}
		const asset = readAsset(database, binding, root);
		let after: Uint8Array | undefined, count = 0;
		const hash = createHash('sha256');
		for (;;) {
			check(signal);
			const rows = database.prepare(`SELECT ${ROOT_COLUMNS} FROM native_photo_media_roots WHERE asset_id=?${after ? ' AND root_key>?' : ''}
				ORDER BY root_key LIMIT ${CATALOG_ORIGINAL_PAGE_SIZE}`).all(...(after ? [binding.assetId, after] : [binding.assetId]));
			for (const row of rows) {
				check(signal); const retained = readRoot(row);
				if (retained.assetId !== root.assetId || retained.mediaContentToken !== root.mediaContentToken
					|| retained.sha256 !== root.sha256 || retained.size !== root.size) throw new Error('Retained native Original aliases disagree.');
				hash.update(JSON.stringify(retained)); hash.update('\n'); count += 1;
				if (!Number.isSafeInteger(count)) throw new RangeError('Native Original custody count exceeds its safe integer bound.');
			}
			if (rows.length < CATALOG_ORIGINAL_PAGE_SIZE) break;
			const last = rows.at(-1)?.root_key;
			if (!(last instanceof Uint8Array)) throw new Error('Native Original custody cursor is corrupt.');
			after = last;
		}
		if (count < 1 || (asset !== null && asset.count !== count)) throw new Error('Native Original root_count differs from its retained inventory.');
		const result = Object.freeze({ root, asset, count, rootsSha256: hash.digest('hex') });
		check(signal); database.exec('COMMIT'); check(signal); return result;
	} catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Original inspection custody and rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}

function readAsset(database: DatabaseSync, binding: Readonly<CatalogOriginalRepairBindingV1>, root: Readonly<CatalogOriginalRootV1>): Readonly<Asset> | null {
	const row = database.prepare(`SELECT a.source_id,
		CASE WHEN typeof(a.sha256)='text' AND length(CAST(a.sha256 AS BLOB))=64 THEN a.sha256 END AS sha256,a.size,
		CASE WHEN typeof(a.media_content_token)='text' AND length(CAST(a.media_content_token AS BLOB))<=142 THEN a.media_content_token END AS token,a.root_count,
		b.storage_key AS binding_key,CASE WHEN typeof(b.content_sha256)='text' AND length(CAST(b.content_sha256 AS BLOB))=64 THEN b.content_sha256 END AS binding_sha,b.byte_length AS binding_size
		FROM native_photo_media_assets a LEFT JOIN native_photo_original_bindings b ON b.storage_key=a.source_id WHERE a.source_id=?`).get(binding.assetId);
	if (!row) return null;
	if (row.source_id !== binding.assetId || !isMediaContentSha256(row.sha256) || row.sha256 !== binding.sha256 || row.size !== binding.size
		|| !isMediaContentToken(row.token) || row.token !== root.mediaContentToken || typeof row.root_count !== 'number'
		|| !Number.isSafeInteger(row.root_count) || row.root_count < 1 || row.binding_key !== binding.assetId
		|| row.binding_sha !== binding.sha256 || row.binding_size !== binding.size) throw new Error('Native Original media generation or physical binding is corrupt.');
	return Object.freeze({ key: binding.assetId, sha256: row.sha256, size: binding.size, token: row.token, count: row.root_count });
}
function readRoot(row: Row): Readonly<CatalogOriginalRootV1> {
	if (typeof row.root !== 'string' || Buffer.byteLength(row.root, 'utf8') > CATALOG_ORIGINAL_ROOT_MAX_BYTES) throw new Error('Native Original root exceeds its bounded profile.');
	const parsed: unknown = JSON.parse(row.root), root = normalizeCatalogOriginalRoot(parsed);
	if (JSON.stringify(root) !== row.root || !same(row.root_key, utf16(root.key)) || !same(row.scope_key, utf16(catalogOriginalScope(root.catalogId, root.importId)))
		|| row.asset_id !== root.assetId) throw new Error('Native Original custody scalar keys or canonical document disagree.');
	return root;
}
function utf16(value: string): Uint8Array {
	const bytes = new Uint8Array(value.length * 2);
	for (let index = 0; index < value.length; index++) { const unit = value.charCodeAt(index); bytes[index * 2] = unit >>> 8; bytes[index * 2 + 1] = unit & 255; }
	return bytes;
}
function same(value: unknown, expected: Uint8Array): boolean {
	return value instanceof Uint8Array && value.byteLength === expected.byteLength && value.every((byte, index) => byte === expected[index]);
}
