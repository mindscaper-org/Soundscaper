/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEnvelopeValueEvaluator } from '../automation.js';
import { readClipLoop } from '../audio-clip-loop.ts';

interface Point { readonly frame: number; readonly value: number }
interface Clip {
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly reversed?: boolean;
	readonly warpMap?: unknown;
	readonly opaqueExtensions?: unknown;
	readonly envelope?: readonly Point[];
}

/** Keep clip gain attached to the same audio across a partial source resize. */
export function remapProcessedSourceEnvelope(clip: Clip, durationFrames: number,
	sourceStartFrame: number, sourceDurationFrames: number,
	mapSource: (frame: number) => number, editStart: number, editEnd: number): Point[] {
	const points = clip.envelope ?? [];
	const retained = new Map<number, Point>();
	const affine = clip.warpMap != null || readClipLoop(clip) !== null;
	const mapLocal = (frame: number): number => {
		if (affine) return frame * durationFrames / clip.durationFrames;
		const offset = frame * clip.sourceDurationFrames / clip.durationFrames;
		const source = clip.reversed ? clip.sourceStartFrame + clip.sourceDurationFrames - offset
			: clip.sourceStartFrame + offset;
		const mapped = mapSource(source);
		return (clip.reversed ? sourceStartFrame + sourceDurationFrames - mapped : mapped - sourceStartFrame)
			* clip.durationFrames / clip.sourceDurationFrames;
	};
	const keep = (point: Point) => {
		const frame = Math.max(0, Math.min(durationFrames, Math.round(mapLocal(point.frame))));
		retained.set(frame, { ...point, frame });
	};
	for (const point of points) keep(point);
	if (!affine && points.length) {
		const evaluate = createEnvelopeValueEvaluator(points, clip.durationFrames);
		for (const boundary of [editStart, editEnd]) {
			const position = (boundary - clip.sourceStartFrame) * clip.durationFrames / clip.sourceDurationFrames;
			const frame = clip.reversed ? clip.durationFrames - position : position;
			if (frame > 0 && frame < clip.durationFrames) keep({ frame, value: evaluate(frame) });
		}
	}
	return [...retained.values()].sort((left, right) => left.frame - right.frame);
}
