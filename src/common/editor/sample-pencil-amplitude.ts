/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateClipFadeAt } from './audio-clip-transition-gain.ts';
import { createEnvelopeValueEvaluator } from './automation.js';
import type { SamplePencilPoint } from './sample-edit-types.ts';

export interface RenderedPencilClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly gain?: number;
	readonly inverted?: boolean;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
	readonly envelope?: readonly Readonly<{ frame: number; value: number }>[];
}

function createSourceAmplitude(clip: RenderedPencilClip) {
	const envelopeAt = createEnvelopeValueEvaluator(clip.envelope, clip.durationFrames);
	return (timelineFrame: number, displayedAmplitude: number): number => {
		const localFrame = timelineFrame - clip.timelineStartFrame;
		const gain = (clip.inverted ? -1 : 1) * (clip.gain ?? 1)
			* evaluateClipFadeAt(localFrame, clip.durationFrames, clip.fadeInFrames ?? 0, 'in', clip.fadeInShape)
			* evaluateClipFadeAt(localFrame, clip.durationFrames, clip.fadeOutFrames ?? 0, 'out', clip.fadeOutShape)
			* envelopeAt(localFrame);
		return gain === 0 ? 0 : Math.max(-1, Math.min(1, displayedAmplitude / gain));
	};
}

/** The pointer addresses the rendered waveform; Pencil writes its underlying PCM. */
export function samplePointerSourceAmplitude(clip: RenderedPencilClip, timelineFrame: number, displayedAmplitude: number): number {
	return createSourceAmplitude(clip)(timelineFrame, displayedAmplitude);
}

export type PencilValueInterpolator = (
	previous: SamplePencilPoint, current: SamplePencilPoint, amount: number, timelineFrame: number,
) => number;

/** Interpolate visible intent before undoing the gain at each addressed sample. */
export function createPencilValueInterpolator(clip: RenderedPencilClip): PencilValueInterpolator {
	const sourceAmplitude = createSourceAmplitude(clip);
	return (previous, current, amount, timelineFrame) => {
		if (amount === 1) return current.value;
		if (previous.renderedValue === undefined || current.renderedValue === undefined) {
			return previous.value + (current.value - previous.value) * amount;
		}
		return sourceAmplitude(timelineFrame,
			previous.renderedValue + (current.renderedValue - previous.renderedValue) * amount);
	};
}
