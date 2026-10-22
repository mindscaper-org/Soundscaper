/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mediaAssetChunkKey } from '../../src/common/editor/storage/media-asset-chunk-records.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE, MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../../src/common/editor/storage/media-asset-chunk-schema.ts';
import { isMediaContentToken } from '../../src/common/editor/storage/media-content-provenance.ts';

interface NativeRecords {
	records(databaseName: string, storeName: string): readonly Record<string, unknown>[];
}
interface OriginalBinding {
	readonly sourceId: string; readonly size: number; readonly sha256: string;
	readonly mediaContentToken?: string; readonly mimeType?: string;
}

/** Observe actual instrumented IndexedDB records, not an alternate media loader.
 * Return only immutable scalar evidence; every copied physical payload is wiped
 * on both success and admission failure. This is Node fixture evidence. */
export function inspectNativeOriginalChunksCurrentV1(backing: NativeRecords, databaseName: string,
	binding: Readonly<OriginalBinding>, expectedBytes?: Uint8Array) {
	const copied: Uint8Array[] = [];
	try {
		const chunks = backing.records(databaseName, 'mediaAssetChunks');
		for (const chunk of chunks) if (chunk.payloadBytes instanceof ArrayBuffer) copied.push(new Uint8Array(chunk.payloadBytes));
		const assets = backing.records(databaseName, 'mediaAssets').filter(row => row.sourceId === binding.sourceId);
		assert.equal(assets.length, 1); const asset = assets[0]!;
		assert.ok(Number.isSafeInteger(binding.size) && binding.size > 0);
		assert.match(binding.sha256, /^[a-f0-9]{64}$/u);
		assert.equal(asset.storage, MEDIA_ASSET_CHUNK_STORAGE_TYPE); assert.equal(Object.hasOwn(asset, 'blob'), false);
		assert.equal(asset.size, binding.size); assert.equal(asset.sha256, binding.sha256);
		assert.equal(asset.mediaContentDigestVersion, 1); assert.ok(isMediaContentToken(asset.mediaContentToken));
		if (binding.mediaContentToken !== undefined) assert.equal(asset.mediaContentToken, binding.mediaContentToken);
		if (binding.mimeType !== undefined) assert.equal(asset.mimeType, binding.mimeType);
		assert.ok(typeof asset.mediaChunkToken === 'string' && asset.mediaChunkToken.length > 0);
		const token = asset.mediaChunkToken, count = Math.ceil(binding.size / MEDIA_ASSET_STREAM_CHUNK_BYTES);
		assert.equal(asset.mediaChunkBytes, MEDIA_ASSET_STREAM_CHUNK_BYTES); assert.equal(asset.mediaChunkCount, count);
		if (expectedBytes !== undefined) assert.equal(expectedBytes.byteLength, binding.size);
		const retained = chunks.filter(chunk => chunk.sourceId === binding.sourceId || chunk.mediaChunkToken === token)
			.sort((left, right) => Number(left.index) - Number(right.index));
		assert.equal(retained.length, count);
		const hash = createHash('sha256'); let offset = 0;
		const evidence = retained.map((chunk, index) => {
			const size = Math.min(MEDIA_ASSET_STREAM_CHUNK_BYTES, binding.size - offset);
			assert.equal(chunk.sourceId, binding.sourceId); assert.equal(chunk.mediaChunkToken, token);
			assert.equal(chunk.key, mediaAssetChunkKey(token, index)); assert.equal(chunk.index, index);
			assert.equal(chunk.byteLength, size); assert.equal(chunk.payloadEncoding, 'array-buffer-v1');
			assert.equal(Object.hasOwn(chunk, 'payload'), false); assert.ok(chunk.payloadBytes instanceof ArrayBuffer);
			const bytes = new Uint8Array(chunk.payloadBytes); assert.equal(bytes.byteLength, size);
			if (expectedBytes !== undefined) assert.deepEqual(bytes, expectedBytes.subarray(offset, offset + size));
			hash.update(bytes); offset += size;
			return Object.freeze({ key: chunk.key, sourceId: chunk.sourceId, mediaChunkToken: token, index,
				byteLength: size, payloadSha256: createHash('sha256').update(bytes).digest('hex') });
		});
		assert.equal(offset, binding.size); const sha256 = hash.digest('hex'); assert.equal(sha256, binding.sha256);
		for (const value of Object.values(asset)) assert.ok(value === null || value === undefined
			|| ['string', 'number', 'boolean'].includes(typeof value), 'Original metadata must not retain a physical body.');
		return Object.freeze({ metadata: Object.freeze({ ...asset }), chunks: Object.freeze(evidence), byteLength: offset, sha256 });
	} finally { for (const bytes of copied) bytes.fill(0); }
}
