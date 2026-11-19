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
	for (const point of [...points].sort((left, right) => left.frame - right.frame)) {
		if (parameterToLinearGain(point.value, unit) === null) continue;
		if (admitted.at(-1)?.frame === point.frame) admitted[admitted.length - 1] = point;
		else admitted.push(point);
	}
	if (admitted.some(point => !Number.isFinite(point.value))) {
		return dawprojectImportedVolumeCurve(admitted.map(point => ({ ...point, value: gain(point.value) })), 'linear', maximum);
	}
	const previous = admitted.filter(point => point.frame < 0).at(-1);
	const visible = admitted.filter(point => point.frame >= 0);
	if (previous && visible[0]?.frame !== 0) {
		const next = visible[0];
		const value = previous.interpolation === 'linear' && next
			? previous.value + (next.value - previous.value) * -previous.frame / (next.frame - previous.frame)
			: previous.value;
		visible.unshift({ frame: 0, value, interpolation: previous.interpolation });
	}
	const output = new Map<number, number>();
	for (const [index, left] of visible.entries()) {
		output.set(left.frame, gain(left.value));
		const right = visible[index + 1];
		if (left.interpolation !== 'linear' || !right
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
