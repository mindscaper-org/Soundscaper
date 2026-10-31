/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorSessionClipboard } from '../../../../session-clipboard-codec.ts';
import type { SourcePcmReadSession, SourceReadOptions } from '../../../../storage/source-read-repository.ts';
import type { AudioSourceWriter } from '../../../../storage/source-write-repository.ts';
import type { StorageRecord } from '../../../../storage/media-records.ts';

/** Optional only for administration fixtures without a media clipboard. */
export interface DeletedProjectClipboardStore {
	getSourceMetadata?(key: string): PromiseLike<unknown>;
	openSourceReadSession?(key: string, options?: SourceReadOptions): PromiseLike<SourcePcmReadSession | null>;
	beginSourceWrite?(key: string, metadata: Record<string, unknown>): PromiseLike<AudioSourceWriter>;
}

/** The clipboard outlives its origin tab; deletion must not remove its sole PCM authority. */
export async function preserveDeletedProjectClipboardMedia(
	projectId: string, clipboard: Readonly<Pick<AudioEditorSessionClipboard, 'originProjectId' | 'sources'>> | null | undefined,
	store: DeletedProjectClipboardStore, assertCurrent: () => void,
): Promise<void> {
	if (!clipboard || clipboard.originProjectId !== projectId) return;
	for (const source of clipboard.sources) {
		assertCurrent();
		if (source.kind === 'video' || source.kind === 'image' || source.kind === 'generator') continue;
		if (!store.getSourceMetadata) throw new Error('Clipboard audio storage is unavailable.');
		const key = String(source.storageKey || source.id);
		const value = await store.getSourceMetadata(key);
		assertCurrent();
		const metadata = record(value);
		if (metadata?.storage !== 'linked-audio-original-v1') continue;
		if (!store.openSourceReadSession || !store.beginSourceWrite) throw new Error('Linked clipboard audio cannot be preserved.');
		const frames = positiveInteger(metadata.frameCount ?? metadata.frameLength);
		const count = positiveInteger(metadata.chunkCount);
		if (frames !== source.frameCount || metadata.channelCount !== source.channelCount || metadata.sampleRate !== source.sampleRate) {
			throw new Error('Linked clipboard audio geometry changed.');
		}
		// Capture the linked provider before publishing owned PCM under the same key.
		const input = await store.openSourceReadSession(key, { expectedSource: metadata as StorageRecord });
		if (!input) throw new Error('The linked clipboard audio could not be read.');
		try {
			assertCurrent();
			const writer = await store.beginSourceWrite(key, {
				sampleRate: source.sampleRate, channelCount: source.channelCount, chunkFrames: metadata.chunkFrames,
			});
			try {
				assertCurrent();
				let copied = 0;
				for (let index = 0; index < count; index += 1) {
					const chunk = await input.chunk(index);
					assertCurrent();
					if (chunk.index !== index || !Number.isSafeInteger(chunk.frames) || chunk.frames <= 0
						|| chunk.channels.length !== source.channelCount || chunk.channels.some((channel) => channel.length !== chunk.frames)
						|| copied + chunk.frames > frames) throw new Error('Linked clipboard audio is incomplete.');
					await writer.write(chunk.channels);
					assertCurrent();
					copied += chunk.frames;
				}
				if (copied !== frames) throw new Error('Linked clipboard audio is missing frames.');
				await writer.commit({}, { ifAbsent: true });
				assertCurrent();
			} catch (error) {
				try { await writer.abort(); }
					catch (cleanup) { throw new AggregateError([error, cleanup], 'Clipboard audio preservation and cleanup failed.', { cause: cleanup }); }
				throw error;
			}
		} finally { await input.release(); }
		assertCurrent();
	}
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function positiveInteger(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('Linked clipboard audio geometry is invalid.');
	return value;
}
