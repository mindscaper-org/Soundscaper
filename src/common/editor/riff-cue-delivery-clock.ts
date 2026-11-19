/* SPDX-License-Identifier: AGPL-3.0-only */

import { scaleSampleFrame } from './timeline-time.ts';

/** Map authored cue coordinates into the same half-open PCM range the writer delivers. */
export function createRiffCueDeliveryClock(range: Readonly<{ startFrame: number; endFrame: number }>,
	inputSampleRate: number, outputSampleRate: number) {
	const frames = scaleSampleFrame(range.endFrame - range.startFrame, inputSampleRate, outputSampleRate, 'enclosingEnd');
	const nearest = (frame: number): number => scaleSampleFrame(frame - range.startFrame, inputSampleRate, outputSampleRate, 'point');
	return {
		point: (frame: number): number => Math.min(frames - 1, nearest(frame)),
		region(startFrame: number, endFrame: number) {
			const sampleOffset = nearest(startFrame);
			const end = endFrame === range.endFrame ? frames : nearest(endFrame);
			return { sampleOffset, sampleLength: end - sampleOffset };
		},
	};
}
