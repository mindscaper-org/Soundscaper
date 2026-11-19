/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipSourceStretchMemory, clipSourceStretchExtensions } from './clip-source-stretch-memory.ts';
import { normalizeAudioWarpMap, evaluateAudioWarpMapAtSource, type AudioWarpMap } from './audio-warp-domain.ts';
import { audioWarpOuterAtTimelineFrame, isMusicalAudioWarpClip } from './audio-warp-runtime-authority.ts';
import { type ClipSourceTimingClip, type ClipSourceTimingProject, type ClipSourceTimingSource } from './clip-source-timing.ts';
import { addRationals, multiplyDivideRationals, multiplyRationals, subtractRationals, type Rational } from './timeline-time.ts';

export interface ClipSourceTrim {
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
}

interface ClipSourceTrimMetadata {
	readonly trimStartFrames?: number;
	readonly trimEndFrames?: number;
}

/** Source edits retain the project anchor and every surviving marker's exact sample. */
export function clipSourceTrimFields(project: ClipSourceTimingProject, clip: ClipSourceTimingClip & ClipSourceTrimMetadata, source: ClipSourceTimingSource, changes: ClipSourceTrim): ClipSourceTrim & Required<ClipSourceTrimMetadata> & Readonly<{ warpMap?: Readonly<AudioWarpMap>; opaqueExtensions?: Readonly<Record<string, unknown>> }> {
	if (clip.kind !== 'audio') throw new RangeError('Source range trimming requires an audio clip.');
	for (const [field, value] of Object.entries(changes)) {
		if (!Number.isSafeInteger(value) || value < (field === 'sourceStartFrame' ? 0 : 1)) throw new RangeError('Clip source range requires whole, positive sample extents.');
	}
	const end = changes.sourceStartFrame + changes.sourceDurationFrames;
	if (end > source.frameCount) throw new RangeError('Clip source range exceeds the media duration.');
	// The trim counters use source samples. Extending into previously hidden
	// media consumes that edge's counter; cutting inward restores it.
	const fields = { ...changes,
		trimStartFrames: Math.max(0, (clip.trimStartFrames ?? 0) + (changes.sourceStartFrame - clip.sourceStartFrame)),
		trimEndFrames: Math.max(0, (clip.trimEndFrames ?? 0) + (clip.sourceStartFrame + clip.sourceDurationFrames - end)),
	};
	if (clip.warpMap == null) return fields;
	const map = clipSourceStretchMemory(project, clip, source)!;
	const startOuter = evaluateAudioWarpMapAtSource(map, changes.sourceStartFrame);
	const endOuter = evaluateAudioWarpMapAtSource(map, end);
	const sourcePoints = [
		{ source: { num: changes.sourceStartFrame, den: 1 }, outer: startOuter },
		...map.points.filter((point) => point.source.num / point.source.den > changes.sourceStartFrame && point.source.num / point.source.den < end),
		{ source: { num: end, den: 1 }, outer: endOuter },
	];
	const displayStart = startOuter.num / startOuter.den;
	const displayDuration = endOuter.num / endOuter.den - displayStart;
	const roundedFrames = sourcePoints.map(({ outer }, index) => index === 0 ? 0 : index === sourcePoints.length - 1
		? changes.durationFrames : Math.round((outer.num / outer.den - displayStart) / displayDuration * changes.durationFrames));
	// A short trim can leave several anchors in one output sample. The map can
	// retain fractions of a sample even though its clip extent uses whole samples.
	const coincident = roundedFrames.some((frame, index) => index > 0 && frame <= roundedFrames[index - 1]!);
	const points = sourcePoints.map(({ source, outer }, index) => ({ source, mode: 'forward' as const,
		outer: coincident ? subSampleOuter(project, clip, multiplyDivideRationals(
			subtractRationals(outer, startOuter), changes.durationFrames, subtractRationals(endOuter, startOuter),
		)) : audioWarpOuterAtTimelineFrame(project, clip, clip.timelineStartFrame + roundedFrames[index]!),
	}));
	return { ...fields, warpMap: normalizeAudioWarpMap({ feature: 'audio-warp', points }), opaqueExtensions: clipSourceStretchExtensions(clip, source, map) };
}

function subSampleOuter(project: ClipSourceTimingProject, clip: ClipSourceTimingClip, frame: Rational): Rational {
	if (!isMusicalAudioWarpClip(clip)) return frame;
	const whole = Math.floor(frame.num / frame.den);
	const position = clip.timelineStartFrame + whole;
	const lower = audioWarpOuterAtTimelineFrame(project, clip, position);
	if (frame.den === 1) return lower;
	const upper = audioWarpOuterAtTimelineFrame(project, clip, position + 1);
	return addRationals(lower, multiplyRationals(subtractRationals(upper, lower), subtractRationals(frame, whole)));
}
