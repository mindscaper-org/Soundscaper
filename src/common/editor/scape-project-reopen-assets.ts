/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDigest, hex } from '../media/bytes.ts';
import { awaitScapeOperation, throwIfScapeAborted } from '../scape/abort.ts';
import { verifyScapeExtractedAsset } from '../scape/asset-bytes.ts';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../scape/archive-envelope.ts';
import type { ScapeExpandedByteBudget } from '../scape/expanded-byte-budget.ts';
import { extractScapeAudio, scapeAudioSourceStream, type ScapeAudioSource } from './scape-archive-media.ts';
import { ScapeAudioChunkBudget } from './scape-expanded-byte-budget.ts';
import { SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES } from './scape-archive-video.ts';
import { EXTERNAL_MEDIA_ENCODING } from './desktop-external-media.ts';
import { ScapeProjectReopenConflictError } from './scape-project-canonical-inspection.ts';
import type { MediaAssetMetadataOptions } from './storage/media-repository.ts';
import { isStoredPcmReadDamage } from './storage/source-read-recovery.ts';

type ReopenAssetStore = Parameters<typeof scapeAudioSourceStream>[0] & Readonly<{
	getMediaAssetMetadata?(key: string, options?: MediaAssetMetadataOptions): PromiseLike<unknown>;
}>;

/** Verify reused archive bodies with the ordinary bounds, without staging or replacing local media. */
export async function verifyScapeReopenAssets(
	entries: ReadonlyMap<string, ScapeArchiveEntry>,
	assets: readonly ScapeAssetDescriptor[],
	sources: readonly Readonly<{ id: string; storageKey?: string }>[],
	budget: ScapeExpandedByteBudget,
	signal?: AbortSignal,
	store?: ReopenAssetStore,
): Promise<void> {
	const sourceById = new Map(sources.map(source => [source.id, source]));
	const audioBudget = new ScapeAudioChunkBudget();
	for (const asset of assets) {
		throwIfScapeAborted(signal);
		if (asset.encoding === EXTERNAL_MEDIA_ENCODING) continue;
		const entry = entries.get(asset.entry);
		if (!entry?.getData) throw new Error(`The Scape archive is missing ${asset.entry}.`);
		if (asset.encoding === 'audio-f32le-chunks-v1') {
			const source = sourceById.get(asset.sourceId);
			if (!source) throw new Error(`The Scape archive is missing source ${asset.sourceId}.`);
			const extracted = await extractScapeAudio(entry, { write: () => Promise.resolve() },
				source as ScapeAudioSource, signal, budget, audioBudget);
			verifyScapeExtractedAsset(asset, extracted.digest, extracted.size, asset.entry);
			if (store) {
				const localDigest = createDigest();
				try {
					await scapeAudioSourceStream(store, source as ScapeAudioSource, localDigest, () => undefined, signal)
						.pipeTo(new WritableStream<Uint8Array>(), { signal });
				} catch (error) {
					throwIfScapeAborted(signal);
					if (!isStoredPcmReadDamage(error)) throw error;
					throw new ScapeProjectReopenConflictError();
				}
				if (hex(localDigest.digest()) !== asset.sha256) throw new ScapeProjectReopenConflictError();
			}
			continue;
		}
		const digest = createDigest();
		let size = 0;
		await awaitScapeOperation(entry.getData(new WritableStream<Uint8Array>({
			write(bytes) {
				throwIfScapeAborted(signal);
				if (!(bytes instanceof Uint8Array) || bytes.byteLength > SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES) {
					throw new RangeError('A Scape asset emission exceeds the fixed 4 MiB chunk limit.');
				}
				budget.consume(bytes.byteLength, asset.entry);
				if (bytes.byteLength > entry.uncompressedSize - size) throw new Error(`${asset.entry} emitted an unexpected size.`);
				digest.update(bytes);
				size += bytes.byteLength;
			},
		}), { signal, strictness: 'strict' }), signal);
		verifyScapeExtractedAsset(asset, hex(digest.digest()), size, asset.entry);
		if (store && asset.kind === 'video') {
			const source = sourceById.get(asset.sourceId);
			const metadata = await awaitScapeOperation(store.getMediaAssetMetadata?.(source?.storageKey || asset.sourceId,
				asset.encoding === 'original' ? { signal, verifyOpfsBodySize: true } : undefined), signal);
			if (!metadata || typeof metadata !== 'object' || !('sha256' in metadata) || !('size' in metadata)
				|| metadata.sha256 !== asset.sha256 || metadata.size !== asset.size) throw new ScapeProjectReopenConflictError();
		}
	}
}
