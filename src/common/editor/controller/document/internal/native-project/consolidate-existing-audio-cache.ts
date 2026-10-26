/* SPDX-License-Identifier: AGPL-3.0-only */
import { openExternalMediaPcm } from '../../../../external-media-pcm-reader.ts';
import { sameStoredSourceIdentity, type StorageRecord } from '../../../../storage/media-records.ts';
import { withConsolidationCleanup } from './consolidation-cleanup.ts';
import type { ConsolidateManagedAudioStore } from './consolidate-managed-audio.ts';

/** A project copy can have consolidated the same immutable PCM already. */
export async function reuseConsolidatedAudioCache(
	store: Pick<ConsolidateManagedAudioStore, 'getSourceMetadata' | 'openSourceReadSession'>,
	source: Readonly<Record<string, unknown>>, original: Blob,
	signal?: AbortSignal, assertCurrent?: () => void,
): Promise<boolean> {
	if (!store.getSourceMetadata) return false;
	const key = String(source.storageKey || source.id);
	const value = await store.getSourceMetadata(key);
	ready();
	if (!value || typeof value !== 'object' || !('storage' in value)
		|| value.storage === 'linked-audio-original-v1') return false;
	const metadata = value as StorageRecord;
	const chunkFrames = integer(metadata.chunkFrames, 65_536);
	const chunkCount = integer(metadata.chunkCount);
	const frameCount = integer(metadata.frameCount ?? metadata.frameLength);
	if (frameCount !== source.frameCount || metadata.channelCount !== source.channelCount
		|| metadata.sampleRate !== source.sampleRate) throw new Error('Existing consolidated PCM geometry differs from its original.');
	const input = await store.openSourceReadSession?.(key, { expectedSource: metadata, signal });
	if (!input) throw new Error('Existing consolidated PCM is unavailable.');
	await withConsolidationCleanup(async () => {
		ready();
		const reader = await openExternalMediaPcm(original, { ...source, chunkFrames }, signal);
		if (!reader) throw new Error('Existing consolidated PCM cannot be verified against its original.');
		let index = 0, frames = 0;
		await reader.stream(async channels => {
			ready();
			const actual = await input.chunk(index++, { signal });
			ready();
			if (actual.channels.length !== channels.length || actual.frames !== channels[0]?.length) {
				throw new Error('Existing consolidated PCM packet geometry differs from its original.');
			}
			for (let channel = 0; channel < channels.length; channel += 1) {
				const expected = channels[channel]!, stored = actual.channels[channel]!;
				const left = new Uint32Array(expected.buffer, expected.byteOffset, expected.length);
				const right = new Uint32Array(stored.buffer, stored.byteOffset, stored.length);
				if (left.length !== right.length || left.some((bits, frame) => bits !== right[frame])) {
					throw new Error('Existing consolidated PCM differs from its original sample bits.');
				}
			}
			frames += actual.frames;
		});
		if (frames !== frameCount || index !== chunkCount) throw new Error('Existing consolidated PCM is incomplete.');
		if (!sameStoredSourceIdentity(await store.getSourceMetadata!(key) as StorageRecord, metadata)) {
			throw new Error('Existing consolidated PCM changed during verification.');
		}
		ready();
	}, () => input.release());
	return true;

	function ready(): void { signal?.throwIfAborted(); assertCurrent?.(); }
}

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new Error('Existing consolidated PCM has invalid physical geometry.');
	}
	return Number(value);
}
