/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { easedVideoKeyframeBezierControls, linearVideoKeyframeBezierControls } from '../src/common/editor/ui/inspector/video-keyframe-bezier-controls.ts';
import { normalizeRational } from '../src/common/editor/timeline-time.ts';
import { compileInterpolationCurve, evaluateInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';

for (const denominator of [999_983, 500_000, 2]) test(`Bezier selection keeps admitted 1/${denominator} anchors editable`, () => {
	const start = { position: { num: 1, den: denominator }, value: 0.2 };
	const end = { position: { num: 1, den: 1 }, value: 0.8 };
	const controls = linearVideoKeyframeBezierControls(start, end);
	assert.doesNotThrow(() => normalizeRational(controls.control1.position));
	assert.doesNotThrow(() => normalizeRational(controls.control2.position));
	const original = compileInterpolationCurve({ anchors: [start, end], segments: [{ kind: 'linear' }] });
	const changed = compileInterpolationCurve({ anchors: [start, end], segments: [{ kind: 'bezier', ...controls }] });
	for (const position of [0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
		assert.ok(Math.abs(evaluateInterpolationCurve(original, position) - evaluateInterpolationCurve(changed, position)) < 1e-12,
			`seeding must preserve the existing line at${String(position)}`);
	}
});

for (const denominator of [999_983, 500_000, 2]) test(`initial Bezier handles fit admitted 1/${denominator} anchors`, () => {
	const start = { position: { num: 1, den: denominator }, value: .2 };
	const end = { position: { num: 1, den: 1 }, value: .8 };
	const controls = easedVideoKeyframeBezierControls(start, end);
	assert.equal(controls.control1.value, start.value);
	assert.equal(controls.control2.value, end.value);
	const curve = compileInterpolationCurve({ anchors: [start, end], segments: [{ kind: 'bezier', ...controls }] });
	assert.equal(evaluateInterpolationCurve(curve, 0), start.value);
	assert.equal(evaluateInterpolationCurve(curve, 1), end.value);
	if (denominator === 2) {
		assert.deepEqual(controls.control1.position, { num: 2, den: 3 });
		assert.deepEqual(controls.control2.position, { num: 5, den: 6 });
	}
});
