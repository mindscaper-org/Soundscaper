/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateClipTransitionGainAt } from './audio-clip-transition-gain.ts';
import type { DawprojectAudioEvent } from './dawproject-import-timeline.ts';

/** Preserve the authored fade positions when import crops an audio clip. */
export function dawprojectImportedClipFades(event: DawprojectAudioEvent, startFrame: number, durationFrames: number) {
	const originalDuration = event.endFrame - event.startFrame;
	const offset = startFrame - event.startFrame;
	const fadeInFrames = Math.min(originalDuration, Math.max(0, event.fadeInFrames));
	const fadeOutFrames = Math.min(originalDuration, Math.max(0, event.fadeOutFrames));
	if ((!fadeInFrames && !fadeOutFrames) || (offset === 0 && durationFrames === originalDuration)) {
		return { fadeInFrames, fadeOutFrames };
	}
	const valueAt = (frame: number): number => evaluateClipTransitionGainAt(offset + frame, originalDuration, {
		fadeInFrames, fadeOutFrames, crossfadeInRanges: [], crossfadeOutRanges: [],
	});
	const frames = new Set([0, durationFrames]);
	for (const boundary of [fadeInFrames, originalDuration - fadeOutFrames]) {
		const frame = boundary - offset;
		if (frame > 0 && frame < durationFrames) frames.add(frame);
	}
	const boundaries = [...frames].sort((left, right) => left - right);
	for (let index = 1; index < boundaries.length; index += 1) subdivide(boundaries[index - 1]!, boundaries[index]!);
	return { fadeInFrames: 0, fadeOutFrames: 0,
		envelope: [...frames].sort((left, right) => left - right).map((frame) => ({ frame, value: valueAt(frame) })) };

	function subdivide(left: number, right: number): void {
		const middle = Math.floor((left + right) / 2);
		if (middle <= left || middle >= right || frames.size >= 4096) return;
		const linear = valueAt(left) + (valueAt(right) - valueAt(left)) * (middle - left) / (right - left);
		if (Math.abs(valueAt(middle) - linear) <= 0.00001) return;
		frames.add(middle); subdivide(left, middle); subdivide(middle, right);
	}
}
