/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortGuard } from '../abort-error.ts';
import { MEDIA_ASSET_STREAM_CHUNK_BYTES } from './media-asset-chunk-schema.ts';
import type { MediaAssetWriteOptions } from './media-asset-write-contract.ts';
import type { MediaAssetWriteRepository } from './media-asset-write-repository.ts';

const check = createAbortGuard('Original media storage was cancelled.');

/** The established transactional writer persists owned byte chunks, avoiding
 * native IndexedDB Blob preparation while retaining its publication fence. */
export async function writeMediaAssetBlobChunks(
	owner: Pick<MediaAssetWriteRepository, 'begin'>,
	sourceId: string,
	blob: Blob,
	metadata: Readonly<Record<string, unknown>>,
	options: MediaAssetWriteOptions,
): Promise<Readonly<Record<string, unknown>>> {
	check(options.signal);
	const writer = await owner.begin(sourceId, metadata, options);
	try {
		for (let offset = 0; offset < blob.size;) {
			check(options.signal);
			const length = Math.min(MEDIA_ASSET_STREAM_CHUNK_BYTES, blob.size - offset);
			const bytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
			try {
				check(options.signal);
				if (bytes.byteLength !== length) throw new Error('Original media staging read has the wrong byte length.');
				await writer.write(bytes, { signal: options.signal });
				check(options.signal);
			} finally { bytes.fill(0); }
			offset += length;
		}
		return await writer.commit({ signal: options.signal });
	} catch (primary) {
		let cleanupFailed = false;
		let cleanupFailure: unknown;
		try { await writer.abort(); }
		catch (cleanup) { cleanupFailed = true; cleanupFailure = cleanup; }
		if (cleanupFailed) {
			throw new AggregateError([primary, cleanupFailure], 'Original media streaming and cleanup failed.', { cause: primary });
		}
		throw primary;
	}
}
