/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClipLoop } from './audio-clip-loop.ts';
import { normalizeAudioWarpRuntimeInputs, isMusicalAudioWarpClip, type AudioWarpAuthorityRuntimeClip } from './audio-warp-runtime-authority.ts';
import { MIDI_FILE_MAX_EVENTS } from './midi-file-types.ts';
import { resolveRuntimeClipProjection, type RuntimePersistedClip, type RuntimeClipProjection } from './runtime-clip-projection.ts';
import { addRationals, beatToSampleFrame, compareRationals, createBreakpointMapEvaluator, roundRational, type HoldTempoMap } from './timeline-time.ts';

interface ProjectionProject extends Readonly<Record<string, unknown>> { readonly sampleRate: number; readonly tempoMap: HoldTempoMap }
export interface MidiClipOccurrence {
	readonly start: number;
	readonly sourceFrames: number;
	readonly timelineStart: number;
	readonly timelineEnd: number;
	readonly initializePerformance?: boolean;
	global(frame: number): number;
}

/** Share playback's warp authority and unfold loop periods before MIDI interchange. */
export function* midiClipOccurrences(project: ProjectionProject, persistedClip: RuntimePersistedClip): Generator<MidiClipOccurrence> {
	const clip = resolveRuntimeClipProjection(project, persistedClip);
	const start = clip.sourceStartFrame;
	const sourceFrames = clip.sourceDurationFrames;
	const loop = readClipLoop(clip);
	if (!loop) {
		yield { start, sourceFrames, timelineStart: clip.timelineStartFrame, timelineEnd: clip.timelineEndFrame, global: sourceProjector(project, clip, clip.timelineStartFrame, clip.durationFrames) };
		return;
	}
	const count = Math.ceil((loop.offsetFrames + clip.durationFrames) / loop.periodFrames);
	if (count > MIDI_FILE_MAX_EVENTS) throw new RangeError('MIDI export contains too many loop repetitions.');
	for (let index = 0; index < count; index += 1) {
		const origin = clip.timelineStartFrame - loop.offsetFrames + index * loop.periodFrames;
		const timelineStart = Math.max(clip.timelineStartFrame, origin);
		const timelineEnd = Math.min(clip.timelineEndFrame, origin + loop.periodFrames);
		const source = (timeline: number): number => start + (clip.reversed === true
			? 1 - (timeline - origin) / loop.periodFrames : (timeline - origin) / loop.periodFrames) * sourceFrames;
		const from = source(timelineStart);
		const to = source(timelineEnd);
		yield { start: Math.min(from, to), sourceFrames: Math.abs(to - from), timelineStart, timelineEnd, initializePerformance: true,
			global: sourceProjector(project, clip, origin, loop.periodFrames) };
	}
}

function sourceProjector(project: ProjectionProject, clip: RuntimeClipProjection, origin: number, period: number): (frame: number) => number {
	if (clip.warpMap != null) {
		const { clip: authority, map } = normalizeAudioWarpRuntimeInputs(project, clip as AudioWarpAuthorityRuntimeClip);
		const points = map.points.map(point => ({ ...point, outer: point.source, source: point.outer }));
		const segments = points.slice(1).map((point, index) => createBreakpointMapEvaluator({ ...map, points: [points[index]!, point] }));
		const musical = isMusicalAudioWarpClip(authority);
		return frame => {
			let low = 0, high = points.length - 1;
			while (low + 1 < high) {
				const middle = Math.floor((low + high) / 2);
				if (compareRationals(frame, points[middle]!.outer) >= 0) low = middle;
				else high = middle;
			}
			const outer = segments[low]!(frame);
			return musical ? beatToSampleFrame(addRationals(authority.musicalStartBeat!, outer), project.tempoMap, project.sampleRate, 'point')
				: clip.timelineStartFrame + roundRational(outer.num, outer.den, 'point');
		};
	}
	return frame => Math.round(origin + (clip.reversed === true ? clip.sourceEndFrame - frame : frame - clip.sourceStartFrame) * period / clip.sourceDurationFrames);
}
