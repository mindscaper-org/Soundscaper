/* SPDX-License-Identifier: AGPL-3.0-only */

import { clamp, parameterToLinearGain } from './dawproject-format.ts';
import type { DawprojectAutomationPoint } from './dawproject-import-timeline.ts';

interface GainPoint { readonly frame: number; readonly value: number }
const MAXIMUM_GENERATED_POINTS = 100_000;
const GAIN_ERROR = 1e-5;

/** Linear DAWproject points interpolate in their declared parameter unit. */
export function dawprojectImportedVolumeCurve(
	points: readonly DawprojectAutomationPoint[], unit: string | null, maximum: number,
): GainPoint[] {
	const admitted: DawprojectAutomationPoint[] = [];
	for (const point of points) {
		if (parameterToLinearGain(point.value, unit) === null) continue;
		const normalized = { ...point, frame: Math.max(0, point.frame) };
		if (admitted.at(-1)?.frame === normalized.frame) admitted[admitted.length - 1] = normalized;
		else admitted.push(normalized);
	}
	const output = new Map<number, number>();
	for (const [index, left] of admitted.entries()) {
		output.set(left.frame, gain(left.value));
		const right = admitted[index + 1];
		if (unit !== 'decibel' || left.interpolation !== 'linear' || !right
			|| !Number.isFinite(left.value) || !Number.isFinite(right.value)) continue;
		const valueAt = (frame: number): number => gain(left.value
			+ (right.value - left.value) * (frame - left.frame) / (right.frame - left.frame));
		subdivide(left.frame, right.frame, gain(left.value), gain(right.value), valueAt);
	}
	return [...output].sort(([left], [right]) => left - right).map(([frame, value]) => ({ frame, value }));

	function gain(value: number): number {
		return clamp(parameterToLinearGain(value, unit) ?? 1, 0, maximum);
	}
	function subdivide(left: number, right: number, leftValue: number, rightValue: number,
		valueAt: (frame: number) => number): void {
		if (right - left <= 1) return;
		const fractions = [0.25, 0.5, 0.75];
		const inaccurate = fractions.some(fraction => {
			const frame = Math.round(left + (right - left) * fraction);
			return frame > left && frame < right && Math.abs(valueAt(frame)
				- (leftValue + (rightValue - leftValue) * (frame - left) / (right - left))) > GAIN_ERROR;
		});
		if (!inaccurate) return;
		if (output.size >= MAXIMUM_GENERATED_POINTS) throw new RangeError('The converted volume curve exceeds its point budget.');
		const middle = left + Math.floor((right - left) / 2), middleValue = valueAt(middle);
		output.set(middle, middleValue);
		subdivide(left, middle, leftValue, middleValue, valueAt);
		subdivide(middle, right, middleValue, rightValue, valueAt);
	}
}
