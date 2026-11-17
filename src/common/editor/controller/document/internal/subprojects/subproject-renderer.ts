/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EnginePublicApi, EngineRenderToSinkOptions } from '../../../../engine/public-api.ts';
import type { EngineProject } from '../../../../engine/types.ts';
import { projectEffectTailFrames } from '../../../../effects.js';
import { scaleSampleFrame } from '../../../../timeline-time.ts';
import { createStoredChunkProvider, createCoalescingSourceWriter, type StoredSourceReader, type StoredSourceMetadata } from '../../../source/source-audio.ts';
import type { OwnedAudioSourceWriter } from '../../../../storage/source-write-repository.ts';
import type { StorageRecord } from '../../../../storage/media-records.ts';
import { projectTrackFolderMediaStateV12 } from '../../../../track-folder-media-runtime.ts';
import { audioBufferChannels } from '../../../../rendered-audio-channels.ts';
import { resampleChannelsWindowedSinc } from '../../../source/source-audio.ts';
import { SOURCE_CHUNK_FRAMES } from '../../../../source-pcm-contract.ts';
import { createAudioSource } from '../../../../project-media-factory.ts';
import { applyMediaChannelMapping } from '../../../../media-export.js';
import { defaultMixerChannelMapV21 } from '../../../../mixer-graph-v21.ts';
import type { SubprojectDocument, SubprojectGeometry, SubprojectRenderedSource } from '../../subproject-actions.ts';
import type { ResolvedSubprojectNode } from './subproject-graph.ts';

export interface SubprojectRenderStore extends StoredSourceReader {
	getSourceMetadata(id: string): Promise<StoredSourceMetadata | null>;
	beginSourceWrite(id: string, metadata: Record<string, unknown>): Promise<OwnedAudioSourceWriter>;
	readonly sourceRepository: { discardIfCurrent(source: StorageRecord): Promise<boolean> };
}
export interface SubprojectRendererRuntime {
	readonly store: SubprojectRenderStore;
	createId(prefix: string): string;
	createEngine(): Pick<EnginePublicApi, 'renderMixToSink'> & {
		readonly renderMix?: EnginePublicApi['renderMix'];
		loadProject(...args: Parameters<EnginePublicApi['loadProject']>): unknown;
		dispose(): PromiseLike<void> | void;
	};
	projectForRuntimeConsumers(project: SubprojectDocument): Readonly<Record<string, unknown>>;
	preflight(bytes: number): Promise<unknown>;
}

/** Bounded chunk readers and the ordinary mixer renderer keep output off the JS heap. */
export function createSubprojectRenderer(runtime: SubprojectRendererRuntime) {
	function plan(project: SubprojectDocument, sampleRate: number): SubprojectGeometry {
		const projected = projectTrackFolderMediaStateV12(runtime.projectForRuntimeConsumers(project));
		const clips = projected.clips as readonly { timelineStartFrame: number; durationFrames: number }[];
		const end = clips.reduce((maximum, clip) => Math.max(maximum, clip.timelineStartFrame + clip.durationFrames), 0);
		if (!end) throw new RangeError('The subproject has no audio to publish.');
		const tail = projectEffectTailFrames(projected, { includeMaster: true });
		const frameCount = scaleSampleFrame(end + tail, project.sampleRate, sampleRate, 'enclosingEnd');
		const channelCount = Number(project.masterChannels ?? 2);
		if (!Number.isSafeInteger(frameCount) || frameCount < 1 || channelCount < 1 || channelCount > 64) throw new RangeError('Invalid subproject publication range.');
		return { sampleRate, channelCount, frameCount };
	}
	async function render(node: ResolvedSubprojectNode, geometry: SubprojectGeometry, signal?: AbortSignal): Promise<SubprojectRenderedSource> {
		const temporary: SubprojectRenderedSource[] = [];
		try {
			async function visit(current: ResolvedSubprojectNode, output: SubprojectGeometry): Promise<SubprojectRenderedSource> {
				signal?.throwIfAborted();
				const project = structuredClone(current.project) as unknown as Record<string, unknown>;
				const sources = project.sources as Record<string, unknown>[];
				for (const { link, node: child } of current.children) {
					if (!child || child.digest === link.contentDigest) continue;
					const rendered = await visit(child, link); temporary.push(rendered);
					const index = sources.findIndex(source => source.id === link.sourceId);
					if (index < 0) throw new ReferenceError('The nested subproject proxy is missing.');
					sources[index] = createAudioSource({ ...rendered.source, id: link.sourceId });
				}
				return await renderOne(project as unknown as SubprojectDocument, output, signal);
			}
			return await visit(node, geometry);
		} finally { for (const source of temporary.reverse()) await source.discard(); }
	}
	async function renderOne(project: SubprojectDocument, geometry: SubprojectGeometry, signal?: AbortSignal): Promise<SubprojectRenderedSource> {
		signal?.throwIfAborted();
		const projected = projectTrackFolderMediaStateV12(runtime.projectForRuntimeConsumers(project));
		assertBackgroundRackSupport(projected);
		const renderChannels = Number(projected.masterChannels ?? 2);
		await runtime.preflight(geometry.frameCount * geometry.channelCount * 4);
		signal?.throwIfAborted();
		const providers = new Map<string, ReturnType<typeof createStoredChunkProvider>>();
		let engine: ReturnType<SubprojectRendererRuntime['createEngine']> | null = null;
		let writer: OwnedAudioSourceWriter | null = null;
		let published = false;
		try {
			const used = new Set((projected.clips as readonly { sourceId: string }[]).map(clip => clip.sourceId));
			for (const value of project.sources) {
				if (!used.has(String(value.id))) continue;
				if (value.kind !== 'audio') throw new RangeError('Audio subprojects require rendered audio sources.');
				const source = { id: String(value.id), storageKey: String(value.storageKey || value.id),
					frameCount: Number(value.frameCount), channelCount: Number(value.channelCount), sampleRate: Number(value.sampleRate) };
				const metadata = await runtime.store.getSourceMetadata(source.storageKey);
				if (!metadata || metadata.frameCount !== source.frameCount || metadata.channelCount !== source.channelCount || metadata.sampleRate !== source.sampleRate) {
					throw new ReferenceError('Subproject source media is missing or has changed.');
				}
				providers.set(source.id, createStoredChunkProvider(runtime.store, source, metadata));
			}
			const id = runtime.createId('subproject-audio');
			writer = await runtime.store.beginSourceWrite(id, { sampleRate: geometry.sampleRate, channelCount: geometry.channelCount, chunkFrames: SOURCE_CHUNK_FRAMES });
			const output = createCoalescingSourceWriter(writer);
			let frames = 0;
			const options: EngineRenderToSinkOptions = { startFrame: 0,
				endFrame: scaleSampleFrame(geometry.frameCount, geometry.sampleRate, project.sampleRate, 'enclosingEnd'),
				includeTail: false, includeMaster: true, respectMuteSolo: true,
				sampleRate: geometry.sampleRate, outputFrames: geometry.frameCount, chunkFrames: 8192, maximumPendingChunks: 8,
				suspendForBackpressure: false,
				preferBoundedOffline: true, signal, sink: async (channels, metadata) => {
					signal?.throwIfAborted();
					const length = channels[0]?.length ?? 0;
					if (metadata.sampleRate !== geometry.sampleRate || channels.length !== renderChannels
						|| !length || length > 65_536 || channels.some(channel => channel.length !== length) || frames + length > geometry.frameCount) {
						throw new RangeError('The subproject renderer changed the published output geometry.');
					}
					const publishedChannels = subprojectOutputChannels(channels, geometry.channelCount);
					await output.write(publishedChannels.map(channel => channel.slice())); frames += length;
				},
			};
			engine = runtime.createEngine();
			engine.loadProject(projected as EngineProject, new Map(), { chunkSources: providers });
			const nativeFrames = options.endFrame!;
			const maximumOfflineBytes = 64 * 1024 * 1024;
			let result;
			if (engine.renderMix && Math.max(nativeFrames, geometry.frameCount) * Math.max(renderChannels, geometry.channelCount) * 4 <= maximumOfflineBytes) {
				// Use the ordinary offline mixer within its existing admission ceiling.
				// Longer publications retain the bounded, continuous-clock sink path.
				const audio = await engine.renderMix({ startFrame: 0, endFrame: nativeFrames, outputFrames: nativeFrames,
					includeTail: false, includeMaster: true, respectMuteSolo: true, signal });
				const input = audioBufferChannels(audio);
				const channels = project.sampleRate === geometry.sampleRate ? input
					: resampleChannelsWindowedSinc([...input], project.sampleRate, geometry.sampleRate, geometry.frameCount);
				for (let offset = 0; offset < (channels[0]?.length ?? 0); offset += 8192) {
					if (typeof options.sink === 'function') await options.sink(channels.map(channel => channel.subarray(offset, offset + 8192)), { sampleRate: geometry.sampleRate });
				}
				result = { sampleRate: geometry.sampleRate, channelCount: channels.length, frameCount: frames };
			} else result = await engine.renderMixToSink(options);
			if (result.sampleRate !== geometry.sampleRate || result.channelCount !== renderChannels || result.frameCount !== frames) {
				throw new RangeError('The subproject renderer returned inconsistent audio.');
			}
			while (frames < geometry.frameCount) {
				signal?.throwIfAborted();
				const count = Math.min(65_536, geometry.frameCount - frames);
				await output.write(Array.from({ length: geometry.channelCount }, () => new Float32Array(count))); frames += count;
			}
			signal?.throwIfAborted();
			const stored = await output.commit(); published = true;
			return { source: { id, kind: 'audio', name: project.title, storageKey: id, ...geometry },
				discard: async () => {
					try { await runtime.store.sourceRepository.discardIfCurrent(stored); }
					catch (error) {
						// Another editor's retention fence can defer reclamation until the
						// pending-source grace expires. It must not fail a valid render.
						if (!(error instanceof Error) || !error.message.includes('retained by another open editor session')) throw error;
					}
				} };
		} finally {
			if (writer && !published) await writer.abort();
			try { await engine?.dispose(); }
			finally { for (const provider of providers.values()) await provider.dispose(); }
		}
	}
	return Object.freeze({ plan, render });
}

function subprojectOutputChannels(channels: readonly Float32Array[], width: number): readonly Float32Array[] {
	if (channels.length === width) return channels;
	if (width <= 2) return applyMediaChannelMapping(channels, width === 1 ? 'mono' : 'stereo');
	return defaultMixerChannelMapV21(channels.length, width).map(channel => channel < 0
		? new Float32Array(channels[0]!.length) : channels[channel]!);
}

function assertBackgroundRackSupport(project: Readonly<Record<string, unknown>>): void {
	const mixer = project.mixer as Record<string, unknown>;
	const owners = [...project.tracks as unknown[], ...project.clips as unknown[], project.master,
		...['groups', 'sends', 'cues'].flatMap(key => Array.isArray(mixer?.[key]) ? mixer[key] as unknown[] : [])];
	for (const value of owners) {
		const owner = value as { effects?: readonly { type?: string; enabled?: boolean; bypassed?: boolean }[]; effectsActive?: boolean };
		if (owner?.effectsActive === false) continue;
		if (owner?.effects?.some(effect => effect.type === 'native-plugin' && effect.enabled !== false && !effect.bypassed)) {
			throw new RangeError('Render or commit native plug-in tracks before using this project as an audio subproject.');
		}
	}
}
