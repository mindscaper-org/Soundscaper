/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeClipForProject, normalizeSourceForProject, assertClipSourceBounds } from './shared-runtime.js';
import type { AudioEditorCommand } from './protocol.ts';
import { evaluateAudioWarpMapAtSource, normalizeAudioWarpMap } from '../audio-warp-domain.ts';
import { audioWarpOuterAtTimelineFrame, isMusicalAudioWarpClip, type AudioWarpAuthorityRuntimeClip, type AudioWarpAuthorityRuntimeProject } from '../audio-warp-runtime-authority.ts';
import { CLIP_SOURCE_STRETCH_EXTENSION, type ClipSourceStretchMemory } from '../clip-source-stretch-memory.ts';
import { addRationals, beatToSampleFrame, compareRationals, multiplyRationals, roundRational, subtractRationals, type Rational } from '../timeline-time.ts';
import { readClipLoop, withClipLoop, type ClipLoop } from '../audio-clip-loop.ts';
import { remapProcessedSourceEnvelope } from './source-process-envelope.ts';

type RecordValue = Record<string, unknown>;
interface Source extends RecordValue {
	id: string;
	kind?: string;
	frameCount: number;
	sampleRate: number;
	channelCount: number;
}
interface Clip extends RecordValue, AudioWarpAuthorityRuntimeClip {
	id: string;
	kind?: string;
	sourceId: string;
	sourceStartFrame: number;
	sourceDurationFrames: number;
	durationFrames: number;
	renderCacheRevision?: number;
	fadeInFrames?: number;
	fadeOutFrames?: number;
	envelope?: readonly Readonly<{ frame: number; value: number }>[];
}
interface Project extends RecordValue, AudioWarpAuthorityRuntimeProject {
	sources: Source[];
	clips: Clip[];
	projectBin?: { clips: Clip[] };
}

interface SourceEdit { readonly startFrame: number; readonly endFrame: number; readonly outputFrames: number }

/** Replace source samples once, retaining each instance's authored processing. */
export function processSourceAudio(projectValue: object, command: Extract<AudioEditorCommand, { type: 'source/process-audio' }>): void {
	const project = projectValue as Project;
	const previous = project.sources.find((source) => source.id === command.sourceId);
	if (!previous || (previous.kind ?? 'audio') !== 'audio') throw new RangeError('Source processing requires an audio source.');
	const next = normalizeSourceForProject(project, command.source) as Source;
	if (next.kind !== 'audio' || next.channelCount !== previous.channelCount || next.sampleRate !== previous.sampleRate) {
		throw new RangeError('Source processing must preserve the channel layout and sample rate.');
	}
	if (project.sources.some((source) => source.id === next.id)) throw new RangeError('Processed audio requires a new source identity.');
	const { startFrame, endFrame } = command;
	if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)
		|| startFrame < 0 || endFrame <= startFrame || endFrame > previous.frameCount) {
		throw new RangeError('Source processing range must lie inside the original source.');
	}
	const outputFrames = next.frameCount - previous.frameCount + endFrame - startFrame;
	if (!Number.isSafeInteger(outputFrames) || outputFrames < 1) throw new RangeError('Processed source range must retain audio.');
	const delta = next.frameCount - previous.frameCount;
	const edit = { startFrame, endFrame, outputFrames };
	const mapFrame = (frame: number): number => frame <= startFrame ? frame : frame >= endFrame
		? frame + delta : startFrame + Math.round((frame - startFrame) * outputFrames / (endFrame - startFrame));
	const mapRational = (frame: Rational): Rational => compareRationals(frame, startFrame) <= 0 ? frame
		: compareRationals(frame, endFrame) >= 0 ? addRationals(frame, delta)
		: addRationals(startFrame, multiplyRationals(subtractRationals(frame, startFrame), { num: outputFrames, den: endFrame - startFrame }));
	project.sources.push(next);
	const replace = (clip: Clip): Clip => {
		if (clip.sourceId !== previous.id) return clip;
		const sourceStartFrame = Math.min(next.frameCount - 1, mapFrame(clip.sourceStartFrame));
		const sourceDurationFrames = Math.max(1, mapFrame(clip.sourceStartFrame + clip.sourceDurationFrames) - sourceStartFrame);
		const ratio = sourceDurationFrames / clip.sourceDurationFrames;
		const loop = delta ? readClipLoop(clip) : null;
		const loopTiming = loop ? remapProcessedLoop(clip, loop, sourceStartFrame, sourceDurationFrames, edit) : null;
		const durationFrames = loopTiming?.durationFrames ?? Math.max(1, Math.round(clip.durationFrames * ratio));
		const changedLoop = loop && loopTiming && (loopTiming.loop.periodFrames !== loop.periodFrames
			|| loopTiming.loop.offsetFrames !== loop.offsetFrames) ? loopTiming.loop : null;
		const warpMap = clip.warpMap ? normalizeAudioWarpMap(clip.warpMap) : null;
		const stretchMemory = remapStretchMemory(clip, previous, next, mapRational, edit);
		const changes: RecordValue = {
			sourceId: next.id, sourceStartFrame, sourceDurationFrames, durationFrames,
			renderCacheRevision: (clip.renderCacheRevision ?? 0) + 1,
			...(delta ? {
				fadeInFrames: Math.min(clip.fadeInFrames ?? 0, durationFrames),
				fadeOutFrames: Math.min(clip.fadeOutFrames ?? 0, durationFrames),
				trimStartFrames: 0, trimEndFrames: 0,
				...(clip.envelope ? { envelope: remapProcessedSourceEnvelope(clip, durationFrames, sourceStartFrame,
					sourceDurationFrames, mapFrame, startFrame, endFrame) } : {}),
			} : {}),
			...(warpMap ? { warpMap: { ...warpMap, points: warpMap.points.map((point) => ({
				...point, source: mapRational(point.source),
				outer: remapWarpOuter(project, clip, point.outer, durationFrames),
			})) } } : {}),
			...stretchMemory,
			...(changedLoop ? { opaqueExtensions: withClipLoop(stretchMemory.opaqueExtensions ?? clip.opaqueExtensions, changedLoop) } : {}),
		};
		const updated = normalizeClipForProject(project, { ...clip, ...changes }) as Clip;
		assertClipSourceBounds(project, updated);
		return updated;
	};
	project.clips = project.clips.map(replace);
	if (project.projectBin) project.projectBin.clips = project.projectBin.clips.map(replace);
}

/** Reproject the first and last audible source boundaries across the same repeats. */
function remapProcessedLoop(clip: Clip, loop: ClipLoop, sourceStartFrame: number, sourceDurationFrames: number, edit: SourceEdit) {
	const oldPeriod = BigInt(loop.periodFrames);
	const oldSpan = BigInt(clip.sourceDurationFrames), newSpan = BigInt(sourceDurationFrames);
	const periodFrames = Math.max(1, roundRational(oldPeriod * newSpan, oldSpan, 'point'));
	const period = BigInt(periodFrames);
	const direction = clip.reversed ? -1n : 1n;
	const oldOrigin = BigInt(clip.sourceStartFrame) + (clip.reversed ? oldSpan : 0n);
	const newOrigin = BigInt(sourceStartFrame) + (clip.reversed ? newSpan : 0n);
	const editLength = BigInt(edit.endFrame - edit.startFrame);
	const editDelta = BigInt(edit.outputFrames) - editLength;
	const editStart = BigInt(edit.startFrame) * oldPeriod;
	const editWidth = editLength * oldPeriod;
	const end = BigInt(loop.offsetFrames) + BigInt(clip.durationFrames);
	const offsetFrames = Math.min(periodFrames - 1, mapPhase(BigInt(loop.offsetFrames)));
	const mappedEnd = end / oldPeriod * period + BigInt(mapPhase(end % oldPeriod));
	const durationFrames = Math.max(1, roundRational(mappedEnd - BigInt(offsetFrames), 1n, 'point'));
	return { loop: { periodFrames, offsetFrames }, durationFrames };

	function mapPhase(phase: bigint): number {
		if (phase === 0n) return 0;
		const coordinate = oldOrigin * oldPeriod + direction * phase * oldSpan;
		const local = coordinate - editStart;
		// Only the portion of the source edit before this boundary contributes to its shift.
		const editedPrefix = local <= 0n ? 0n : local >= editWidth ? editWidth : local;
		const mapped = (coordinate - newOrigin * oldPeriod) * editLength + editDelta * editedPrefix;
		const offset = roundRational(direction * mapped * period, editWidth * newSpan, 'point');
		return Math.max(0, Math.min(periodFrames, offset));
	}
}

function remapWarpOuter(project: Project, clip: Clip, outer: Rational, durationFrames: number): Rational {
	if (durationFrames === clip.durationFrames || compareRationals(outer, 0) === 0) return outer;
	if (!isMusicalAudioWarpClip(clip)) return multiplyRationals(outer, { num: durationFrames, den: clip.durationFrames });
	// Beat spacing can change across tempo events: scale elapsed samples before
	// recovering the beat position, as the command projection does for the extent.
	const frame = beatToSampleFrame(addRationals(clip.musicalStartBeat!, outer), project.tempoMap, project.sampleRate);
	const offset = Math.round((frame - clip.timelineStartFrame) * durationFrames / clip.durationFrames);
	return audioWarpOuterAtTimelineFrame(project, clip, clip.timelineStartFrame + offset);
}

function remapStretchMemory(clip: Clip, previous: Source, next: Source, mapFrame: (frame: Rational) => Rational,
	range: SourceEdit): RecordValue {
	const extensions = clip.opaqueExtensions && typeof clip.opaqueExtensions === 'object'
		? clip.opaqueExtensions as RecordValue : null;
	const memory = extensions?.[CLIP_SOURCE_STRETCH_EXTENSION] as ClipSourceStretchMemory | undefined;
	if (!memory || memory.sourceId !== previous.id || memory.sourceFrameCount !== previous.frameCount) return {};
	const map = normalizeAudioWarpMap(memory.map);
	const outerStart = evaluateAudioWarpMapAtSource(map, range.startFrame);
	const outerEnd = evaluateAudioWarpMapAtSource(map, range.endFrame);
	const factor = { num: range.outputFrames, den: range.endFrame - range.startFrame };
	const outerDelta = multiplyRationals(subtractRationals(outerEnd, outerStart), subtractRationals(factor, 1));
	// Hidden display positions belong to the archived warp's project-sample
	// domain. Its source endpoints locate the edit even across different grids.
	const mapOuter = (outer: Rational): Rational => compareRationals(outer, outerStart) <= 0 ? outer
		: compareRationals(outer, outerEnd) >= 0 ? addRationals(outer, outerDelta)
		: addRationals(outerStart, multiplyRationals(subtractRationals(outer, outerStart), factor));
	return { opaqueExtensions: { ...extensions, [CLIP_SOURCE_STRETCH_EXTENSION]: {
		sourceId: next.id, sourceFrameCount: next.frameCount,
		map: { ...map, points: map.points.map((point) => ({ ...point, source: mapFrame(point.source), outer: mapOuter(point.outer) })) },
	} } };
}
