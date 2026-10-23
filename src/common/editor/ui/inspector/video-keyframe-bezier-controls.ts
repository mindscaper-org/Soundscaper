/* SPDX-License-Identifier: AGPL-3.0-only */

import { addRationals, multiplyRationals, normalizeRational } from '../../timeline-time.ts';
import type { InterpolationAnchor } from '../../interpolation-curve.ts';

/** Seed handles on the existing line, preserving its values and exact time span. */
export function linearVideoKeyframeBezierControls(start: InterpolationAnchor, end: InterpolationAnchor): Readonly<{
	control1: InterpolationAnchor; control2: InterpolationAnchor;
}> {
	const control = (weight: number): InterpolationAnchor => ({
		position: addRationals(
			multiplyRationals(start.position, { num: 3 - weight, den: 3 }),
			multiplyRationals(end.position, { num: weight, den: 3 }),
		),
		value: start.value + (end.value - start.value) * weight / 3,
	});
	const controls = { control1: control(1), control2: control(2) };
	try {
		normalizeRational(controls.control1.position);
		normalizeRational(controls.control2.position);
		return controls;
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		// Endpoint handles describe the same line without inventing a wider clock.
		return { control1: { position: { ...start.position }, value: start.value },
			control2: { position: { ...end.position }, value: end.value } };
	}
}

/** Preserve the creation form's flat endpoint handles on the same admitted clock. */
export function easedVideoKeyframeBezierControls(start: InterpolationAnchor, end: InterpolationAnchor) {
	const controls = linearVideoKeyframeBezierControls(start, end);
	return { control1: { ...controls.control1, value: start.value },
		control2: { ...controls.control2, value: end.value } };
}
