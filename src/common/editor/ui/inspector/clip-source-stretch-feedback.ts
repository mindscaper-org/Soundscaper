/* SPDX-License-Identifier: AGPL-3.0-only */
import { addRationals, beatToSampleFrame } from '../../timeline-time.ts';
import { isMusicalAudioWarpClip } from '../../audio-warp-runtime-authority.ts';
import { normalizeAudioWarpMap } from '../../audio-warp-domain.ts';
import { clipSourceDisplayRange, type ClipSourceTimingProject, type ClipSourceTimingClip, type ClipSourceTimingSource } from '../../clip-source-timing.ts';

/** Normalize marker authority once, then read stored outer coordinates directly. */
export function createClipSourceStretchPlan(project: ClipSourceTimingProject, clip: ClipSourceTimingClip, source: ClipSourceTimingSource) {
	const points = clip.warpMap ? normalizeAudioWarpMap(clip.warpMap).points : [];
	const start = clipSourceDisplayRange(clip, source, project.sampleRate).startFrame;
	const musical = clip.warpMap != null && isMusicalAudioWarpClip(clip);
	const displayFrames = points.map(point => start + (musical
		? beatToSampleFrame(addRationals(clip.musicalStartBeat!, point.outer), project.tempoMap, project.sampleRate) - clip.timelineStartFrame
		: point.outer.num / point.outer.den));
	return { points, displayFrames, feedback(pointIndex: number, requestedFrame?: number) {
		const before = points[pointIndex - 1], point = points[pointIndex], after = points[pointIndex + 1];
		if (!before || !point || !after) return null;
		const beforeSample = before.source.num / before.source.den, sourceFrame = point.source.num / point.source.den, afterSample = after.source.num / after.source.den;
		const beforeFrame = displayFrames[pointIndex - 1]!, afterFrame = displayFrames[pointIndex + 1]!;
		const firstFrame = Math.floor(beforeFrame) + 1, lastFrame = Math.ceil(afterFrame) - 1;
		const canMove = firstFrame <= lastFrame && (requestedFrame === undefined || Number.isFinite(requestedFrame));
		const displayFrame = requestedFrame !== undefined && canMove
			? Math.max(firstFrame, Math.min(lastFrame, Math.round(requestedFrame))) : displayFrames[pointIndex]!;
		return { sourceFrame, displayFrame, canMove,
			beforeSpeed: (sourceFrame - beforeSample) / source.sampleRate * project.sampleRate / (displayFrame - beforeFrame),
			afterSpeed: (afterSample - sourceFrame) / source.sampleRate * project.sampleRate / (afterFrame - displayFrame),
		};
	} };
}

/** Adjacent speeds are source seconds per output second, independent of sample rate. */
export function clipSourceStretchFeedback(project: ClipSourceTimingProject, clip: ClipSourceTimingClip, source: ClipSourceTimingSource, pointIndex: number, requestedFrame?: number) {
	return createClipSourceStretchPlan(project, clip, source).feedback(pointIndex, requestedFrame);
}

export function formatSourceStretchSpeed(ratio: number): string {
	return `${ratio.toFixed(2)}× (${Number((ratio * 100).toFixed(1))}%)`;
}
