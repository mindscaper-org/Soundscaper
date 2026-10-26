/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateAudioWarpMapAtSource, normalizeAudioWarpMap, type AudioWarpMap } from './audio-warp-domain.ts';
import { clipSourceDisplayRange, clipSourcePreviewWarpMap, type ClipSourceTimingClip, type ClipSourceTimingProject, type ClipSourceTimingSource } from './clip-source-timing.ts';
import { addRationals, compareRationals, subtractRationals, multiplyDivideRationals, type Rational } from './timeline-time.ts';
import { remapAudioWarpSourceWindow } from './audio-warp-source-window.ts';

export const CLIP_SOURCE_STRETCH_EXTENSION = 'org.soundscaper.clipSourceStretch';
interface StretchClip extends ClipSourceTimingClip { readonly sourceId?: unknown; readonly opaqueExtensions?: unknown }
export interface ClipSourceStretchMemory { readonly sourceId: unknown; readonly sourceFrameCount: number; readonly map: Readonly<AudioWarpMap> }

/** Keep hidden source anchors in the clip's existing serializable extension envelope. */
export function clipSourceStretchMemory(project: ClipSourceTimingProject, clip: StretchClip, source: ClipSourceTimingSource) {
	const extension = extensionsOf(clip)[CLIP_SOURCE_STRETCH_EXTENSION] as ClipSourceStretchMemory | undefined;
	const current = clipSourcePreviewWarpMap(project, clip, source);
	if (!current) return null;
	const previous = extension && extension.sourceId === clip.sourceId && extension.sourceFrameCount === source.frameCount
		? normalizeAudioWarpMap(extension.map) : null;
	const range = clipSourceDisplayRange(clip, source, project.sampleRate);
	const points = current.points.map((point) => ({ ...point, outer: addRationals(point.outer, range.startFrame) }));
	if (clip.sourceStartFrame > 0) points.unshift({ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' });
	if (clip.sourceStartFrame + clip.sourceDurationFrames < source.frameCount) points.push({ outer: { num: range.totalFrames, den: 1 }, source: { num: source.frameCount, den: 1 }, mode: 'forward' });
	if (!previous) return normalizeAudioWarpMap({ feature: 'audio-warp', points });
	const start = clip.sourceStartFrame;
	const end = start + clip.sourceDurationFrames;
	const oldStart = evaluateAudioWarpMapAtSource(previous, start);
	const oldEnd = evaluateAudioWarpMapAtSource(previous, end);
	const shift = subtractRationals(addRationals(oldStart, clip.durationFrames), oldEnd);
	return normalizeAudioWarpMap({ feature: 'audio-warp', points: [
		...previous.points.filter((point) => numberOf(point.source) < start),
		...current.points.map((point) => ({ ...point, outer: addRationals(oldStart, point.outer) })),
		...previous.points.filter((point) => numberOf(point.source) > end).map((point) => ({ ...point, outer: addRationals(point.outer, shift) })),
	] });
}

export function clipSourceStretchExtensions(clip: StretchClip, source: ClipSourceTimingSource, map: Readonly<AudioWarpMap>) {
	return { ...extensionsOf(clip), [CLIP_SOURCE_STRETCH_EXTENSION]: { sourceId: clip.sourceId ?? null, sourceFrameCount: source.frameCount, map } };
}

/** A resampled source retains hidden anchors on its replacement sample grid. */
export function resampledClipSourceStretchFields(
	clip: StretchClip,
	previous: Readonly<{ id: string; frameCount: number }>,
	replacement: Readonly<{ id: string; frameCount: number }>,
): Readonly<{ opaqueExtensions?: Readonly<Record<string, unknown>> }> {
	const extensions = extensionsOf(clip);
	const memory = extensions[CLIP_SOURCE_STRETCH_EXTENSION] as ClipSourceStretchMemory | undefined;
	if (!memory || memory.sourceId !== previous.id || memory.sourceFrameCount !== previous.frameCount) return {};
	const map = remapAudioWarpSourceWindow(memory.map,
		{ sourceStartFrame: 0, sourceDurationFrames: previous.frameCount },
		{ sourceStartFrame: 0, sourceDurationFrames: replacement.frameCount });
	return { opaqueExtensions: { ...extensions, [CLIP_SOURCE_STRETCH_EXTENSION]: {
		sourceId: replacement.id, sourceFrameCount: replacement.frameCount, map,
	} } };
}

/** A replacement file keeps authored source-time anchors that still exist in its media. */
export function replacedClipSourceStretchFields(
	clip: StretchClip,
	previous: ClipSourceTimingSource & Readonly<{ id: string }>,
	replacement: ClipSourceTimingSource & Readonly<{ id: string }>,
	projectSampleRate: number,
): Readonly<{ opaqueExtensions?: Readonly<Record<string, unknown>> }> {
	const extensions = extensionsOf(clip);
	const memory = extensions[CLIP_SOURCE_STRETCH_EXTENSION] as ClipSourceStretchMemory | undefined;
	if (!memory || memory.sourceId !== previous.id || memory.sourceFrameCount !== previous.frameCount) return {};
	const original = normalizeAudioWarpMap(memory.map);
	const map = normalizeAudioWarpMap({ ...original, points: original.points.map(point => ({ ...point,
		source: multiplyDivideRationals(point.source, replacement.sampleRate, previous.sampleRate),
	})) });
	const last = map.points.at(-1)!;
	const end = replacement.frameCount;
	const outer = compareRationals(end, last.source) <= 0 ? evaluateAudioWarpMapAtSource(map, end)
		: addRationals(last.outer, multiplyDivideRationals(subtractRationals(end, last.source), projectSampleRate, replacement.sampleRate));
	const rebound = normalizeAudioWarpMap({ ...map, points: [
		...map.points.filter(point => compareRationals(point.source, end) < 0),
		{ source: { num: end, den: 1 }, outer, mode: 'forward' },
	] });
	return { opaqueExtensions: { ...extensions, [CLIP_SOURCE_STRETCH_EXTENSION]: {
		sourceId: replacement.id, sourceFrameCount: replacement.frameCount, map: rebound,
	} } };
}

/** Clipboard destinations use their own timeline sample grid around the same source. */
export function retimedClipSourceStretchFields(
	clip: Pick<StretchClip, 'sourceId' | 'opaqueExtensions'>, sampleRate: number, previousSampleRate: number,
): Readonly<{ opaqueExtensions?: Readonly<Record<string, unknown>> }> {
	if (sampleRate === previousSampleRate) return {};
	const extensions = extensionsOf(clip);
	const memory = extensions[CLIP_SOURCE_STRETCH_EXTENSION] as ClipSourceStretchMemory | undefined;
	if (!memory || memory.sourceId !== clip.sourceId) return {};
	const map = normalizeAudioWarpMap(memory.map);
	return { opaqueExtensions: { ...extensions, [CLIP_SOURCE_STRETCH_EXTENSION]: {
		...memory, map: { ...map, points: map.points.map(point => ({ ...point,
			outer: multiplyDivideRationals(point.outer, sampleRate, previousSampleRate),
		})) },
	} } };
}

function extensionsOf(clip: Pick<StretchClip, 'opaqueExtensions'>): Readonly<Record<string, unknown>> {
	return clip.opaqueExtensions && typeof clip.opaqueExtensions === 'object' && !Array.isArray(clip.opaqueExtensions)
		? clip.opaqueExtensions as Readonly<Record<string, unknown>> : {};
}
function numberOf(value: Rational): number { return value.num / value.den; }
