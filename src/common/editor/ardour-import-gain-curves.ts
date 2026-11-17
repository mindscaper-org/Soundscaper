/* SPDX-License-Identifier: AGPL-3.0-only */
import type { InterchangeAutomationPoint } from './interchange-automation.ts';

export interface ArdourGainFactor { readonly gain: number; readonly points: readonly InterchangeAutomationPoint[] }

/** Multiply independently automated input trim and send controls on their sample clock. */
export function composeArdourGainCurves(factors: readonly ArdourGainFactor[]): readonly InterchangeAutomationPoint[] | null {
	const curves = factors.map(factor => ({ ...factor, points: [...new Map([...factor.points].sort((a, b) => a.frame - b.frame)
		.map(point => [point.frame, point])).values()] }));
	const positions = new Set<number>();
	for (const curve of curves) for (const [index, point] of curve.points.entries()) {
		positions.add(point.frame);
		if (index && curve.points[index - 1]!.interpolation === 'hold' && point.frame > curve.points[index - 1]!.frame) positions.add(point.frame - 1);
	}
	if (!positions.size) return null;
	const valueAt = (frame: number) => curves.reduce((gain, curve) => gain * evaluate(curve, frame), 1);
	const sorted = [...positions].sort((a, b) => a - b), output: InterchangeAutomationPoint[] = [];
	const append = (frame: number) => {
		const value = valueAt(frame);
		if (!Number.isFinite(value)) throw new RangeError('Ardour composed send gain must be finite.');
		if (output.length >= 100000) throw new RangeError('Ardour composed send automation exceeds its point limit.');
		output.push({ frame, value, interpolation: 'linear' });
	};
	const subdivide = (left: number, right: number): void => {
		if (right - left <= 1) return;
		const a = valueAt(left), b = valueAt(right);
		if ([.25, .5, .75].every(fraction => {
			const frame = Math.round(left + (right - left) * fraction);
			return Math.abs(valueAt(frame) - (a + (b - a) * (frame - left) / (right - left))) <= 1e-5;
		})) return;
		const middle = left + Math.floor((right - left) / 2);
		subdivide(left, middle); append(middle); subdivide(middle, right);
	};
	for (const [index, frame] of sorted.entries()) {
		append(frame);
		if (index + 1 < sorted.length) subdivide(frame, sorted[index + 1]!);
	}
	return output;
}

function evaluate(curve: ArdourGainFactor, frame: number): number {
	if (!curve.points.length) return curve.gain;
	let low = 0, high = curve.points.length;
	while (low < high) { const middle = (low + high) >>> 1; if (curve.points[middle]!.frame <= frame) low = middle + 1; else high = middle; }
	const left = curve.points[Math.max(0, low - 1)]!, right = curve.points[low];
	return !right || frame <= left.frame || left.interpolation === 'hold' ? left.value
		: left.value + (right.value - left.value) * (frame - left.frame) / (right.frame - left.frame);
}
