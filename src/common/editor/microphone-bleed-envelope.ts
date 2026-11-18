/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEnvelopeValueEvaluator } from './automation.js';
import { MICROPHONE_BLEED_MAXIMUM_POINTS, type MicrophoneBleedPoint } from './microphone-bleed.ts';

/** Multiply only the selected interval, retaining original points and the curve outside it. */
export function composeMicrophoneBleedEnvelope(existing: readonly MicrophoneBleedPoint[], durationFrames: number,
	curve: readonly MicrophoneBleedPoint[], offsetFrames: number): MicrophoneBleedPoint[] {
	const original = createEnvelopeValueEvaluator(existing, durationFrames);
	const curveDuration = curve.at(-1)?.frame ?? 0;
	if (curveDuration <= 0 || curve.every(point => point.value === 1)) return existing.map(point => ({ ...point }));
	const reduction = createEnvelopeValueEvaluator(curve, curveDuration);
	const start = Math.max(0, offsetFrames), end = Math.min(durationFrames, offsetFrames + curveDuration);
	if (end <= start) return existing.map(point => ({ ...point }));
	const inside = curve.filter(point => point.frame + offsetFrames >= start && point.frame + offsetFrames <= end);
	if (reduction(start - offsetFrames) === 1 && reduction(end - offsetFrames) === 1 && inside.every(point => point.value === 1)) {
		return existing.map(point => ({ ...point }));
	}
	const knots = new Set([0, durationFrames, start, end, ...existing.map(point => point.frame),
		...inside.map(point => point.frame + offsetFrames)]);
	const evaluate = (frame: number): number => original(frame) * (frame >= start && frame <= end ? reduction(frame - offsetFrames) : 1);
	const frames = [...knots].sort((a, b) => a - b), points: MicrophoneBleedPoint[] = [];
	const push = (frame: number, value: number): void => {
		if (points.length >= MICROPHONE_BLEED_MAXIMUM_POINTS) throw new RangeError('Too many envelope points. Select a shorter range.');
		points.push({ frame, value });
	};
	// The product of two linear segments is quadratic. Subdivide to bound linear approximation error.
	const segment = (left: number, right: number, a: number, b: number): void => {
		const middle = Math.floor((left + right) / 2), value = evaluate(middle);
		const interpolated = a + (b - a) * (middle - left) / (right - left);
		if (middle > left && Math.abs(value - interpolated) > .000025) {
			segment(left, middle, a, value); segment(middle, right, value, b);
		} else push(right, b);
	};
	push(frames[0]!, evaluate(frames[0]!));
	for (let index = 1; index < frames.length; index++) segment(frames[index - 1]!, frames[index]!, evaluate(frames[index - 1]!), evaluate(frames[index]!));
	return points;
}
