/* SPDX-License-Identifier: AGPL-3.0-only */
import { ClipTimePitchRenderCacheCoordinator } from '../../../../clip-time-pitch-cache.js';
import { clipNeedsTimePitchRender } from '../../../../clip-time-pitch-cache-plan.js';
import { clipTimePitchPlaybackProjection } from '../../../../clip-time-pitch-playback-projection.ts';
import type { EngineProject, EngineSourceResolver } from '../../../../engine/types.ts';
import { createStoredChunkProvider, type StoredSourceReader, type StoredSourceMetadata } from '../../../source/source-audio.ts';
import type { OwnedAudioSourceWriter } from '../../../../storage/source-write-repository.ts';

interface Store extends StoredSourceReader {
	getSourceMetadata(id: string): Promise<StoredSourceMetadata | null>;
	beginSourceWrite(id: string, metadata: Record<string, unknown>): Promise<OwnedAudioSourceWriter>;
}

/** A saved child owns its transforms independently of the active parent's playback caches. */
export async function prepareSubprojectTimePitchSources(project: EngineProject, store: Store, signal?: AbortSignal,
	cache = new ClipTimePitchRenderCacheCoordinator({ store })) {
	const providers: ReturnType<typeof createStoredChunkProvider>[] = [];
	const sources = new Map<string, Readonly<{ chunkSource: ReturnType<typeof createStoredChunkProvider>;
		sourceStartFrame: 0; sourceDurationFrames: number; reversed: false }>>();
	const close = async (): Promise<void> => {
		try { for (const provider of providers) await provider.dispose(); }
		finally { await cache.dispose(); }
	};
	try {
		for (const clip of project.clips ?? []) {
			if (clip.kind !== 'audio') continue;
			const source = project.sources?.find(source => source.id === clip.sourceId) as Readonly<Record<string, unknown>> | undefined;
			if (!source) continue;
			const playback = clipTimePitchPlaybackProjection(project, clip, source);
			if (!clipNeedsTimePitchRender(playback)) continue;
			signal?.throwIfAborted();
			const entry = await cache.prepareCommittedOutput(playback, source, { signal, projectSampleRate: project.sampleRate });
			signal?.throwIfAborted();
			const metadata = await store.getSourceMetadata(entry.cacheSourceId);
			if (!metadata) throw new ReferenceError('The subproject clip render is missing.');
			const provider = createStoredChunkProvider(store, { id: entry.cacheSourceId, storageKey: entry.cacheSourceId,
				frameCount: entry.frameCount, channelCount: entry.channelCount, sampleRate: entry.sampleRate }, metadata);
			providers.push(provider);
			sources.set(String(clip.id), { chunkSource: provider, sourceStartFrame: 0, sourceDurationFrames: entry.frameCount, reversed: false });
		}
		const resolve: EngineSourceResolver | null = sources.size ? clip => sources.get(String(clip.id)) ?? null : null;
		return { resolve, close };
	} catch (error) { await close(); throw error; }
}
