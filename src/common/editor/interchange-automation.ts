/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeAutomationLaneV21, type AutomationLaneV21 } from './automation-lane-v21.ts';
import { thinAutomationLaneCaptureV21 } from './automation-lane-thinning-v21.ts';
import type { InterpolationShape } from './interpolation-curve.ts';
import type { ParameterAddress } from './parameter-address.ts';

export interface InterchangeAutomationPoint {
	readonly frame: number;
	readonly value: number;
	readonly interpolation: 'hold' | 'linear';
}

/** Convert units before admission, sampling nonlinear unit conversions to a bounded error. */
export function interchangeAutomationLane(points: readonly InterchangeAutomationPoint[], address: ParameterAddress,
	createId: (prefix: string) => string, convert: (value: number) => number = value => value): AutomationLaneV21 | null {
	const sorted = [...points].sort((a, b) => a.frame - b.frame);
	const unique: InterchangeAutomationPoint[] = [];
	for (const point of sorted) {
		if (!Number.isSafeInteger(point.frame) || !Number.isFinite(point.value)) throw new RangeError('Imported automation requires finite values and safe sample positions.');
		if (unique.at(-1)?.frame === point.frame) unique[unique.length - 1] = point;
		else unique.push(point);
	}
	const previous = unique.filter(point => point.frame < 0).at(-1);
	const visible = unique.filter(point => point.frame >= 0);
	if (previous && visible[0]?.frame !== 0) {
		const next = visible[0];
		const value = previous.interpolation === 'linear' && next
			? previous.value + (next.value - previous.value) * -previous.frame / (next.frame - previous.frame) : previous.value;
		visible.unshift({ frame: 0, value, interpolation: previous.interpolation });
	}
	if (!visible.length) return null;
	const output: InterchangeAutomationPoint[] = [];
	for (const [index, point] of visible.entries()) {
		append(point.frame, convert(point.value), point.interpolation);
		const next = visible[index + 1];
		if (!next || point.interpolation === 'hold') continue;
		const valueAt = (frame: number) => convert(point.value + (next.value - point.value) * (frame - point.frame) / (next.frame - point.frame));
		subdivide(point.frame, next.frame, convert(point.value), convert(next.value), valueAt);
	}
	const lane = { id: createId('automation'), address, timebase: 'absolute-samples',
		points: output.map(point => ({ id: createId('point'), position: point.frame, value: point.value })),
		segments: output.slice(0, -1).map((point): InterpolationShape => ({ kind: point.interpolation })) };
	return output.length > 4096 ? thinAutomationLaneCaptureV21(lane, { automationTolerance: 1e-5 }) : normalizeAutomationLaneV21(lane);

	function append(frame: number, value: number, interpolation: 'hold' | 'linear'): void {
		if (!Number.isFinite(value)) throw new RangeError('Converted automation must be finite.');
		if (output.length >= 100_000) throw new RangeError('Imported automation exceeds its point budget.');
		output.push({ frame, value, interpolation });
	}
	function subdivide(a: number, b: number, av: number, bv: number, valueAt: (frame: number) => number): void {
		if (b - a <= 1) return;
		const inaccurate = [.25, .5, .75].some(fraction => {
			const frame = Math.round(a + (b - a) * fraction);
			return frame > a && frame < b && Math.abs(valueAt(frame) - (av + (bv - av) * (frame - a) / (b - a))) > 1e-5;
		});
		if (!inaccurate) return;
		const middle = a + Math.floor((b - a) / 2), value = valueAt(middle);
		subdivide(a, middle, av, value, valueAt); append(middle, value, 'linear'); subdivide(middle, b, value, bv, valueAt);
	}
}
