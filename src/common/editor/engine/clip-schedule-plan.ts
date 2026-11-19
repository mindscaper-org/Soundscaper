/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_STORAGE_CHUNK_FRAMES } from '../chunk-stream.js';
import { readClipLoop, withoutClipLoop } from '../audio-clip-loop.ts';
import { buildAudioWarpRuntimeSegments } from '../audio-warp-runtime.ts';
import {
	mergeFrameRanges,
} from '../audio-clip-overlap.ts';
import type {
	ClipCrossfadeRanges,
	FrameRange,
} from '../audio-clip-overlap.ts';
import {
	clipDuration,
	clipStart,
	getProjectClips,
	nonNegativeInteger,
	positiveInteger,
} from './buffer-math.ts';
import type {
	EngineChunkReadContext,
	EngineChunkReadValue,
	EngineChunkSource,
	EngineClip,
	EngineProject,
	EngineSourceResolver,
	ResolvedClipSource,
	UnknownRecord,
} from './types.ts';

import { getTrackClips, automaticCrossfadeRanges } from './clip-schedule-geometry.ts';
import { indexedClipScheduleRange } from './clip-schedule-index.ts';
import { preferOfflineChunkSource } from './offline-buffer-source.ts';
import { prepareClipScheduleEnvelopes } from './clip-envelope-preparation.ts';
import { clipEffectInputKey } from './clip-effect-inputs.ts';
import { defaultWindowedSincRadius } from '../resample-geometry.ts';

export { mergeFrameRanges, getTrackClips, automaticCrossfadeRanges };
export type { ClipCrossfadeRanges, FrameRange };

const BUFFERED_CHUNK_LOOP_BUDGET_BYTES = 4 * 1024 ** 2;
// Bound sinc work on the caller's thread as well as the retained PCM.
const BUFFERED_CHUNK_LOOP_SINC_BUDGET = 1024 ** 2;

export interface ClipSchedulePlan extends ClipCrossfadeRanges {
	/** One original, forward PCM period to read before scheduling this loop. */
	readonly chunkLoopRange?: Readonly<{ startFrame: number; endFrame: number; outputFrames: number }>;
	readonly loopSourceStartFrame?: number;
	readonly loopSourceEndFrame?: number;
	readonly clip: EngineClip;
	readonly trackInput: AudioNode;
	readonly originalBuffer: AudioBuffer | null;
	readonly chunkSource: EngineChunkSource | null;
	readonly reversed: boolean;
	readonly offsetFrame: number;
	readonly sourceSampleRate: number;
	readonly playbackRate: number;
	readonly segmentDuration: number;
	readonly segmentStart: number;
	readonly segmentEnd: number;
	readonly relativeStart: number;
	readonly duration: number;
}

export function normalizeSourceResolver(value: unknown): EngineSourceResolver | null {
	if (value == null) return null;
	if (typeof value !== 'function') throw new TypeError('sourceResolver must be a function or null.');
	return value as EngineSourceResolver;
}

export function normalizeChunkSource(value: unknown): EngineChunkSource {
	const source = asRecord(value, 'A long-source chunk provider is required.');
	const descriptor = source.descriptor && typeof source.descriptor === 'object'
		? source.descriptor as UnknownRecord
		: source;
	const channelCount = positiveInteger(descriptor.channelCount, 0);
	const frameCount = positiveInteger(descriptor.frameCount ?? descriptor.frameLength, 0);
	const chunkFrames = positiveInteger(descriptor.chunkFrames, 0);
	const sampleRate = positiveInteger(descriptor.sampleRate, 0);
	if (!channelCount || channelCount > 64 || !frameCount || !sampleRate) {
		throw new TypeError('Long-source metadata is invalid.');
	}
	if (chunkFrames > AUDIO_EDITOR_STORAGE_CHUNK_FRAMES) {
		throw new RangeError(`Long-source chunks cannot exceed ${AUDIO_EDITOR_STORAGE_CHUNK_FRAMES} frames.`);
	}
	const readStorageChunk = source.readStorageChunk || source.readChunk;
	if (typeof readStorageChunk !== 'function') throw new TypeError('A long source must provide readStorageChunk().');
	const read = readStorageChunk as (
		this: UnknownRecord,
		chunkIndex: number,
		context?: EngineChunkReadContext,
	) => Promise<EngineChunkReadValue> | EngineChunkReadValue;
	return Object.freeze({
		channelCount,
		frameCount,
		chunkFrames,
		sampleRate,
		boundedReads: source.boundedReads === true,
		readStorageChunk: (chunkIndex: number, context?: EngineChunkReadContext) => (
			read.call(source, chunkIndex, context)
		),
	});
}

export function resolveClipSource(
	clip: EngineClip,
	project: EngineProject,
	sources: ReadonlyMap<unknown, AudioBuffer>,
	sourceResolver: EngineSourceResolver | null,
	chunkSources: ReadonlyMap<unknown, EngineChunkSource> = new Map(),
): ResolvedClipSource {
	const fallback: ResolvedClipSource = {
		buffer: sources.get(clip.sourceId) || null,
		chunkSource: chunkSources.get(String(clip.sourceId)) || chunkSources.get(clip.sourceId) || null,
		sourceStartFrame: nonNegativeInteger(clip.sourceStartFrame, 0),
		sourceDurationFrames: null,
		reversed: Boolean(clip.reversed),
	};
	if (!sourceResolver || clip.linkPitchAndTempo === true) return fallback;
	const value = sourceResolver(clip, {
		project,
		sources,
		defaultBuffer: fallback.buffer,
	});
	if (value == null) return fallback;
	const resolved = isAudioBuffer(value) ? { buffer: value } : asRecord(
		value,
		'sourceResolver must return an AudioBuffer, a source descriptor, or null.',
	);
	const buffer = resolved.buffer ?? fallback.buffer;
	if (buffer != null && !isAudioBuffer(buffer)) {
		throw new TypeError('sourceResolver returned an invalid AudioBuffer.');
	}
	const chunkSource = resolved.chunkSource ?? fallback.chunkSource;
	return {
		buffer,
		chunkSource: chunkSource == null ? null : chunkSource as EngineChunkSource,
		sourceStartFrame: resolved.sourceStartFrame == null
			? fallback.sourceStartFrame
			: nonNegativeInteger(resolved.sourceStartFrame, fallback.sourceStartFrame),
		sourceDurationFrames: resolved.sourceDurationFrames == null
			? null
			: Math.max(1, nonNegativeInteger(resolved.sourceDurationFrames, 1)),
		reversed: resolved.reversed == null ? fallback.reversed : Boolean(resolved.reversed),
	};
}

export interface BuildClipSchedulePlansOptions {
	readonly project: EngineProject;
	readonly sources: ReadonlyMap<unknown, AudioBuffer>;
	readonly chunkSources?: ReadonlyMap<unknown, EngineChunkSource>;
	readonly trackInputs: ReadonlyMap<string, AudioNode>;
	readonly fromFrame: number;
	readonly toFrame: number;
	readonly sampleRate: number;
	readonly sourceResolver?: EngineSourceResolver | null;
	readonly offlineSampleRate?: number;
	readonly chunkLoopSampleRate?: number;
}

export function buildClipSchedulePlans({
	project,
	sources,
	chunkSources = new Map(),
	trackInputs,
	fromFrame,
	toFrame,
	sampleRate,
	sourceResolver = null,
	offlineSampleRate,
	chunkLoopSampleRate,
}: BuildClipSchedulePlansOptions): ClipSchedulePlan[] {
	let clipsById: ReadonlyMap<string, EngineClip> | null = null;
	let chunkLoopBudgetBytes = BUFFERED_CHUNK_LOOP_BUDGET_BYTES;
	let chunkLoopSincBudget = BUFFERED_CHUNK_LOOP_SINC_BUDGET;
	const plans: ClipSchedulePlan[] = [];
	const audioTracks = (project.tracks || [])
		.filter((track) => track.type !== 'label' && track.type !== 'video');
	for (const [trackIndex, track] of audioTracks.entries()) {
		const laneInput = trackInputs.get(String(track.id ?? trackIndex));
		if (!laneInput) continue;
		const indexed = indexedClipScheduleRange(project, track, fromFrame, toFrame);
		if (!indexed) clipsById ||= new Map(getProjectClips(project).map((clip) => [String(clip.id), clip]));
		const trackClips = indexed?.clips ?? getTrackClips(track, clipsById!);
		const crossfades = indexed?.crossfades ?? automaticCrossfadeRanges(trackClips);
		for (const clip of trackClips) {
			const trackInput = trackInputs.get(clipEffectInputKey(clip.id)) ?? laneInput;
			const start = clipStart(clip);
			const duration = clipDuration(clip);
			const end = start + duration;
			const segmentStart = Math.max(start, fromFrame);
			const segmentEnd = Math.min(end, toFrame);
			if (segmentEnd <= segmentStart) continue;
			const loop = readClipLoop(clip);
			if (loop) {
				const resolved = preferOfflineChunkSource(resolveClipSource(clip, project, sources, sourceResolver, chunkSources), offlineSampleRate);
				const sourceDuration = resolved.sourceDurationFrames ?? clip.sourceDurationFrames ?? loop.periodFrames;
				const sourceSampleRate = resolved.buffer?.sampleRate ?? resolved.chunkSource?.sampleRate ?? sampleRate;
				const outputSamples = loop.periodFrames * (resolved.chunkSource?.channelCount ?? 0);
				const bytes = outputSamples * Float32Array.BYTES_PER_ELEMENT;
				const sincWork = sourceDuration === loop.periodFrames ? 0
					: outputSamples * defaultWindowedSincRadius(sourceDuration, loop.periodFrames);
				const endFrame = resolved.sourceStartFrame + sourceDuration;
				const chunkLoopRange = !resolved.buffer && resolved.chunkSource && clip.warpMap == null
					&& chunkLoopSampleRate === sampleRate && sourceDuration * sampleRate === loop.periodFrames * sourceSampleRate
					&& segmentEnd - segmentStart > loop.periodFrames && endFrame <= resolved.chunkSource.frameCount
					&& bytes <= chunkLoopBudgetBytes && sincWork <= chunkLoopSincBudget
					? { startFrame: resolved.sourceStartFrame, endFrame, outputFrames: loop.periodFrames } : undefined;
				if (resolved.buffer || chunkLoopRange) {
					if (chunkLoopRange) {
						chunkLoopBudgetBytes -= bytes;
						chunkLoopSincBudget -= sincWork;
					}
					const loopSourceStartFrame = !resolved.buffer ? 0 : resolved.reversed ? resolved.buffer.length - endFrame : resolved.sourceStartFrame;
					const bufferFrames = chunkLoopRange?.outputFrames ?? sourceDuration;
					const bufferRate = chunkLoopRange ? sampleRate : sourceSampleRate;
					const phase = (segmentStart - start + loop.offsetFrames) % loop.periodFrames;
					plans.push({ clip, ...(crossfades.get(String(clip.id)) ?? { crossfadeInRanges: [], crossfadeOutRanges: [] }),
						trackInput, originalBuffer: resolved.buffer, chunkSource: chunkLoopRange ? resolved.chunkSource : null, reversed: resolved.reversed,
						...(chunkLoopRange ? { chunkLoopRange } : {}),
						loopSourceStartFrame, loopSourceEndFrame: loopSourceStartFrame + bufferFrames,
						offsetFrame: loopSourceStartFrame + phase * bufferFrames / loop.periodFrames, sourceSampleRate: bufferRate,
						playbackRate: bufferFrames * sampleRate / (loop.periodFrames * bufferRate),
						segmentStart, segmentEnd, segmentDuration: (segmentEnd - segmentStart) / sampleRate,
						relativeStart: segmentStart - start, duration });
					continue;
				}
				const origin = start - loop.offsetFrames;
				let repeatStart = origin + Math.floor((segmentStart - origin) / loop.periodFrames) * loop.periodFrames;
				for (; repeatStart < segmentEnd; repeatStart += loop.periodFrames) {
					const shift = Math.max(0, -repeatStart);
					const virtual = { ...clip, opaqueExtensions: withoutClipLoop(clip.opaqueExtensions),
						timelineStartFrame: repeatStart + shift, durationFrames: loop.periodFrames };
					const repeats = buildClipSchedulePlans({ project: { ...project, clips: [virtual], tracks: [{ ...track, clipIds: [String(clip.id)] }] },
						sources, chunkSources, trackInputs, fromFrame: Math.max(segmentStart, repeatStart) + shift, toFrame: Math.min(segmentEnd, repeatStart + loop.periodFrames) + shift, sampleRate, sourceResolver, offlineSampleRate });
					const crossfade = crossfades.get(String(clip.id)) ?? { crossfadeInRanges: [], crossfadeOutRanges: [] };
					plans.push(...repeats.map(plan => ({ ...plan, ...crossfade, clip, duration, segmentStart: plan.segmentStart - shift, segmentEnd: plan.segmentEnd - shift, relativeStart: plan.segmentStart - shift - start })));
				}
				continue;
			}
			// A scalar pitch/speed cache cannot stand in for an authored piecewise
			// map. Warped clips resolve only their canonical source media here.
			const resolvedSource = preferOfflineChunkSource(resolveClipSource(
				clip,
				project,
				sources,
				clip.warpMap == null ? sourceResolver : null,
				chunkSources,
			), offlineSampleRate);
			const originalBuffer = resolvedSource.buffer;
			const chunkSource = resolvedSource.chunkSource;
			if (!originalBuffer && !chunkSource) continue;
			const sourceSampleRate = originalBuffer?.sampleRate ?? chunkSource?.sampleRate ?? sampleRate;
			const clipCrossfades = crossfades.get(String(clip.id)) || {
				crossfadeInRanges: [],
				crossfadeOutRanges: [],
			};
			if (clip.warpMap != null) {
				const warpSegments = buildAudioWarpRuntimeSegments(
					project as Parameters<typeof buildAudioWarpRuntimeSegments>[0],
					clip as Parameters<typeof buildAudioWarpRuntimeSegments>[1],
					{ startFrame: segmentStart, endFrame: segmentEnd, sourceSampleRate },
				);
				const sourceFrameCount = originalBuffer?.length ?? chunkSource?.frameCount ?? 0;
				for (const segment of warpSegments) {
					const sourceStartFrame = segment.sourceStartFrame.num / segment.sourceStartFrame.den;
					const sourceEndFrame = segment.sourceEndFrame.num / segment.sourceEndFrame.den;
					const offsetFrame = resolvedSource.reversed
						? Math.max(0, sourceFrameCount - sourceEndFrame)
						: sourceStartFrame;
					plans.push({
						clip,
						...clipCrossfades,
						trackInput,
						originalBuffer,
						chunkSource,
						reversed: resolvedSource.reversed,
						offsetFrame,
						sourceSampleRate,
						playbackRate: segment.playbackRate,
						segmentDuration: (segment.timelineEndFrame - segment.timelineStartFrame) / sampleRate,
						segmentStart: segment.timelineStartFrame,
						segmentEnd: segment.timelineEndFrame,
						relativeStart: segment.timelineStartFrame - start,
						duration,
					});
				}
				continue;
			}
			const relativeStart = segmentStart - start;
			const sourceStart = resolvedSource.sourceStartFrame;
			const sourceDuration = resolvedSource.sourceDurationFrames
				?? Math.max(1, nonNegativeInteger(clip.sourceDurationFrames, duration));
			const sourceFramesPerTimelineFrame = sourceDuration / Math.max(1, duration);
			const relativeSourceStart = relativeStart * sourceFramesPerTimelineFrame;
			const sourceFrameCount = originalBuffer?.length ?? chunkSource?.frameCount ?? 0;
			const reversed = resolvedSource.reversed;
			const offsetFrame = reversed
				? Math.max(0, sourceFrameCount - (sourceStart + sourceDuration) + relativeSourceStart)
				: sourceStart + relativeSourceStart;
			const segmentDuration = (segmentEnd - segmentStart) / sampleRate;
			const playbackRate = sourceDuration * sampleRate / Math.max(1, duration * sourceSampleRate);
			plans.push({
				clip,
				...clipCrossfades,
				trackInput,
				originalBuffer,
				chunkSource,
				reversed,
				offsetFrame,
				sourceSampleRate,
				playbackRate,
				segmentDuration,
				segmentStart,
				segmentEnd,
				relativeStart,
				duration,
			});
		}
	}
	return prepareClipScheduleEnvelopes(plans);
}

function isAudioBuffer(value: unknown): value is AudioBuffer {
	if (!value || typeof value !== 'object') return false;
	const buffer = value as Partial<AudioBuffer>;
	return typeof buffer.getChannelData === 'function'
		&& typeof buffer.sampleRate === 'number'
		&& Number.isFinite(buffer.sampleRate)
		&& typeof buffer.length === 'number'
		&& Number.isSafeInteger(buffer.length)
		&& buffer.length > 0;
}

function asRecord(value: unknown, message: string): UnknownRecord {
	if (!value || typeof value !== 'object') throw new TypeError(message);
	return value as unknown as UnknownRecord;
}
