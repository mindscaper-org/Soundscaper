/* SPDX-License-Identifier: AGPL-3.0-only */

import { scaleSampleFrame } from '../timeline-time.ts';

type TimingClip = Readonly<Record<string, unknown>>;

/** The selected-media path reads an unprocessed, forward source range. */
export function hasAssistanceIdentityTiming(clip: TimingClip, projectRate: number, sourceRate: number): boolean {
	return clip.reversed === false && clip.speedRatio === 1 && clip.pitchCents === 0
		&& clip.stretchToTempo === false && clip.anchor === 'sample' && clip.warpMap === null
		&& Number.isSafeInteger(clip.durationFrames) && Number(clip.durationFrames) > 0
		&& Number.isSafeInteger(sourceRate) && sourceRate > 0
		&& clip.sourceDurationFrames === Number(scaleSampleFrame(Number(clip.durationFrames), projectRate, sourceRate, 'point'));
}
