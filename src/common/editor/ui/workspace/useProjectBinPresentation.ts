/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import { projectBinItems, projectBinWaveformPath, projectBinTransformBadges, formatProjectBinDuration } from './project-bin-model.ts';
import { projectBinVideoPreviewModel, projectBinVisualDurationFrames } from './project-bin-video-preview-model.ts';
import { videoTimingRegistryToken } from '../../video-source-time.ts';
import { resolveRuntimeClipProjection, type RuntimeClipProject, type RuntimePersistedClip } from '../../runtime-clip-projection.ts';

type BinClip = NonNullable<Parameters<typeof projectBinItems>[0]>[number] & { readonly sourceId?: string };
type BinSource = Parameters<typeof projectBinTransformBadges>[1] & { readonly id: string };
const EMPTY_CLIPS: readonly BinClip[] = [];
const EMPTY_SOURCES: readonly BinSource[] = [];

/** Published document collections own these joins; playback progress does not. */
export function useProjectBinItems(clips: readonly BinClip[] = EMPTY_CLIPS) {
	return useMemo(() => projectBinItems(clips), [clips]);
}

export function useProjectBinSources(items: ReturnType<typeof projectBinItems>, sources: readonly BinSource[] = EMPTY_SOURCES) {
	const sourceById = useMemo(() => {
		const index = new Map<string, BinSource>();
		for (const source of sources) index.set(source.id, source);
		return index;
	}, [sources]);
	return useMemo(() => {
		const itemSources = new Map<string, (BinSource | null)[]>();
		for (const item of items) itemSources.set(item.id, item.clips.map(clip => sourceById.get((clip as BinClip).sourceId ?? '') ?? null));
		return { sourceById, itemSources };
	}, [items, sourceById]);
}

export function useProjectBinWaveformPath(visual: Parameters<typeof projectBinWaveformPath>[0], clip: Parameters<typeof projectBinWaveformPath>[1], project?: unknown) {
	const warpProject = clip.warpMap != null ? project : undefined;
	return useMemo(() => projectBinWaveformPath(visual, clip, 160, 44, warpProject), [visual?.buffer, visual?.peaks, clip, warpProject]);
}

export function useProjectBinTransformBadges(clips: readonly BinClip[], sources: readonly Parameters<typeof projectBinTransformBadges>[1][], copy: Parameters<typeof projectBinTransformBadges>[2]) {
	return useMemo(() => {
		const badges = new Set<string>();
		for (const [index, clip] of clips.entries()) {
			for (const badge of projectBinTransformBadges(clip, sources[index], copy)) badges.add(badge);
		}
		return [...badges];
	}, [clips, sources, copy]);
}

export function useProjectBinMediaTiming(project: Parameters<typeof projectBinVideoPreviewModel>[0], videoClip: Parameters<typeof projectBinVideoPreviewModel>[1], videoSource: Parameters<typeof projectBinVideoPreviewModel>[2], visualClip: Parameters<typeof projectBinVisualDurationFrames>[1], timingToken = videoTimingRegistryToken()) {
	const videoPreview = useMemo(() => projectBinVideoPreviewModel(project, videoClip, videoSource), [project, videoClip, videoSource, timingToken]);
	const visualDuration = useMemo(() => projectBinVisualDurationFrames(project, visualClip), [project, visualClip]);
	return { videoPreview, visualDuration };
}

/** Audio bin leaves retain musical coordinates, just as their timeline instances do. */
export function useProjectBinAudioDuration(project: RuntimeClipProject | null | undefined, clip: RuntimePersistedClip) {
	return useMemo(() => {
		if (!project || clip.kind !== 'audio') return null;
		try { return resolveRuntimeClipProjection(project, clip).durationFrames; }
		catch { return null; }
	}, [project, clip]);
}

export function useProjectBinDuration(durationFrames: number, sampleRate: number, locale: string) {
	return useMemo(() => formatProjectBinDuration(durationFrames, sampleRate, locale), [durationFrames, sampleRate, locale]);
}

/** Counts are document membership, independent of the preview's transport state. */
export function useProjectBinInstanceCount(count: (id: string) => number, id: string, timelineClips: unknown, binClips: unknown) {
	return useMemo(() => count(id), [count, id, timelineClips, binClips]);
}
