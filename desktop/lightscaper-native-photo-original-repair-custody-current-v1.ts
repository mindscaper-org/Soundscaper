/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { catalogOriginalKey, catalogOriginalScope, normalizeCatalogOriginalRoot,
	type CatalogOriginalRootV1 } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import type { CatalogOriginalRepairBindingV1 } from '../src/common/editor/storage/media-catalog-original-repair-contract.ts';
import { isMediaContentSha256, isMediaContentToken } from '../src/common/editor/storage/media-content-provenance.ts';
import { readLightscaperNativeOriginalBindingCurrentV1, type LightscaperNativeOriginalBindingCurrentV1 as Binding } from './lightscaper-native-original-index-current-v1.ts';
import { readLightscaperNativeOriginalBodyHeadCurrentV1 as readHead,
	type LightscaperNativeOriginalBodyHeadCurrentV1 as Head } from './lightscaper-native-original-body-head-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';

type Row = Record<string, SQLOutputValue>;
export interface LightscaperNativePhotoOriginalRepairStateCurrentV1 {
	readonly root: Readonly<CatalogOriginalRootV1>;
	readonly asset: Readonly<{ token: string; sha256: string; size: number }> | null;
	readonly binding: Readonly<Binding> | null;
	readonly head: Readonly<Head>;
	readonly count: number;
}
const ROOT = `CASE WHEN typeof(root_key)='blob' AND length(root_key)<=4096 THEN root_key END AS root_key,
	CASE WHEN typeof(scope_key)='blob' AND length(scope_key)<=4096 THEN scope_key END AS scope_key,
	CASE WHEN typeof(asset_id)='text' AND length(CAST(asset_id AS BLOB))<=128 THEN asset_id END AS asset_id,
	CASE WHEN typeof(root)='text' AND length(CAST(root AS BLOB))<=2048 THEN root END AS root`;

/** Caller owns the short snapshot/IMMEDIATE transaction. Missing rows are
 * explicit repair inputs; contradictory present rows never become absence.
 * Descriptive metadata is neither selected nor decoded. */
export function readLightscaperNativePhotoOriginalRepairStateCurrentV1(db: DatabaseSync,
	binding: Readonly<CatalogOriginalRepairBindingV1>, signal?: AbortSignal): Readonly<LightscaperNativePhotoOriginalRepairStateCurrentV1> {
	if (!db.isTransaction) throw new Error('Native Original repair custody requires its actual transaction.');
	check(signal); const key = catalogOriginalKey(binding.catalogId, binding.importId, binding.photoId);
	const selected = db.prepare(`SELECT ${ROOT} FROM native_photo_media_roots WHERE root_key=?`).get(utf16(key));
	if (!selected) throw new Error('The exact selected native catalog Original root is missing.');
	const root = readRoot(selected);
	if (root.key !== key || root.catalogId !== binding.catalogId || root.importId !== binding.importId || root.photoId !== binding.photoId
		|| root.assetId !== binding.assetId || root.sourceId !== binding.sourceId || root.sha256 !== binding.sha256 || root.size !== binding.size) {
		throw new Error('Selected native Original custody differs from its repair binding.');
	}
	const assetRow = db.prepare(`SELECT CASE WHEN typeof(sha256)='text' AND length(CAST(sha256 AS BLOB))=64 THEN sha256 END AS sha256,size,
		CASE WHEN typeof(media_content_token)='text' AND length(CAST(media_content_token AS BLOB))<=142 THEN media_content_token END AS token,root_count
		FROM native_photo_media_assets WHERE source_id=?`).get(binding.assetId);
	let asset: LightscaperNativePhotoOriginalRepairStateCurrentV1['asset'] = null;
	if (assetRow) {
		if (!isMediaContentSha256(assetRow.sha256) || assetRow.sha256 !== root.sha256 || assetRow.size !== root.size
			|| !isMediaContentToken(assetRow.token) || assetRow.token !== root.mediaContentToken || typeof assetRow.root_count !== 'number'
			|| !Number.isSafeInteger(assetRow.root_count) || assetRow.root_count < 1) throw new Error('Native Original media identity is corrupt.');
		asset = Object.freeze({ token: assetRow.token, sha256: assetRow.sha256, size: root.size });
	}
	const physical = db.prepare(`SELECT storage_key,CASE WHEN typeof(content_sha256)='text' AND length(CAST(content_sha256 AS BLOB))=64
		THEN content_sha256 END AS content_sha256,byte_length FROM native_photo_original_bindings WHERE storage_key=?`).get(binding.assetId);
	const expected = Object.freeze({ storageKey: binding.assetId, byteLength: binding.size, contentSha256: binding.sha256 });
	const stored = physical ? readLightscaperNativeOriginalBindingCurrentV1({ storageKey: physical.storage_key,
		byteLength: physical.byte_length, contentSha256: physical.content_sha256 }) : null;
	if (stored && JSON.stringify(stored) !== JSON.stringify(readLightscaperNativeOriginalBindingCurrentV1(expected))) {
		throw new Error('Native Original physical binding contradicts retained custody.');
	}
	if (db.prepare('SELECT 1 FROM native_photo_original_bindings WHERE content_sha256=? AND byte_length<>? LIMIT 1').get(binding.sha256, binding.size)) {
		throw new Error('Native Original digest aliases have conflicting lengths.');
	}
	let after: Uint8Array | undefined, count = 0;
	for (;;) {
		check(signal); const rows = db.prepare(`SELECT ${ROOT} FROM native_photo_media_roots WHERE asset_id=?${after ? ' AND root_key>?' : ''}
			ORDER BY root_key LIMIT 64`).all(...(after ? [binding.assetId, after] : [binding.assetId]));
		for (const row of rows) {
			const retained = readRoot(row);
			if (retained.assetId !== root.assetId || retained.mediaContentToken !== root.mediaContentToken
				|| retained.sha256 !== root.sha256 || retained.size !== root.size) throw new Error('Retained native Original aliases disagree.');
			count++; if (!Number.isSafeInteger(count)) throw new RangeError('Native Original root count exceeds its safe integer bound.');
		}
		if (rows.length < 64) break;
		const last = rows.at(-1)?.root_key; if (!(last instanceof Uint8Array)) throw new Error('Native Original custody cursor is corrupt.'); after = last;
	}
	if (count < 1 || (assetRow && assetRow.root_count !== count)) throw new Error('Native Original root_count differs from its retained inventory.');
	check(signal); return Object.freeze({ root, asset, binding: stored, head: readHead(db, expected), count });
}

function readRoot(row: Row): Readonly<CatalogOriginalRootV1> {
	if (typeof row.root !== 'string') throw new Error('Native Original root exceeds its bounded profile.');
	const root = normalizeCatalogOriginalRoot(JSON.parse(row.root) as unknown);
	if (JSON.stringify(root) !== row.root || !same(row.root_key, utf16(root.key))
		|| !same(row.scope_key, utf16(catalogOriginalScope(root.catalogId, root.importId))) || row.asset_id !== root.assetId) {
		throw new Error('Native Original custody keys or canonical document disagree.');
	}
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
