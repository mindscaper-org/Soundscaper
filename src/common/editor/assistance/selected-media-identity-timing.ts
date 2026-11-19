/* SPDX-License-Identifier: AGPL-3.0-only */

import { scaleSampleFrame } from '../timeline-time.ts';
import { readClipLoop } from '../audio-clip-loop.ts';

type TimingClip = Readonly<Record<string, unknown>>;

/** The selected-media path reads an unprocessed, forward source range. */
export function hasAssistanceIdentityTiming(clip: TimingClip, projectRate: number, sourceRate: number): boolean {
	const { durationFrames: duration, sourceDurationFrames: sourceDuration } = clip;
	return clip.reversed === false && clip.speedRatio === 1 && clip.pitchCents === 0
		&& clip.stretchToTempo === false && clip.anchor === 'sample' && clip.warpMap === null
		&& readClipLoop(clip) === null
		&& typeof duration === 'number' && Number.isSafeInteger(duration) && duration > 0
		&& typeof sourceDuration === 'number' && Number.isSafeInteger(sourceDuration) && sourceDuration > 0
		&& Number.isSafeInteger(sourceRate) && sourceRate > 0
		&& (duration === Math.max(1, scaleSampleFrame(sourceDuration, sourceRate, projectRate, 'point'))
			|| sourceDuration === scaleSampleFrame(duration, projectRate, sourceRate, 'point'));
}

/** Use the authored endpoints that the renderer interpolates between. */
export function projectAssistanceSourceRange(clip: TimingClip, startFrame: number, endFrame: number) {
	const { timelineStartFrame, sourceStartFrame, durationFrames, sourceDurationFrames } = clip;
	if (typeof timelineStartFrame !== 'number' || !Number.isSafeInteger(timelineStartFrame) || timelineStartFrame < 0
		|| typeof sourceStartFrame !== 'number' || !Number.isSafeInteger(sourceStartFrame) || sourceStartFrame < 0
		|| typeof durationFrames !== 'number' || !Number.isSafeInteger(durationFrames) || durationFrames < 1
		|| typeof sourceDurationFrames !== 'number' || !Number.isSafeInteger(sourceDurationFrames) || sourceDurationFrames < 1) return null;
	if (startFrame < timelineStartFrame || endFrame - timelineStartFrame > durationFrames || endFrame <= startFrame) return null;
	const start = sourceStartFrame + scaleSampleFrame(startFrame - timelineStartFrame, durationFrames, sourceDurationFrames, 'point');
	const end = sourceStartFrame + scaleSampleFrame(endFrame - timelineStartFrame, durationFrames, sourceDurationFrames, 'point');
	return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start
		? { startFrame: start, endFrame: end } : null;
}
