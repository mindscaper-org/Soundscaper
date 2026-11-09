/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readAepNumeric, aepNumericCurve } from '../src/common/editor/aep-property-reader.ts';
import { parseAepContainer } from '../src/common/editor/aep-container.ts';
import { aepFile, aepList, aepNumeric } from './helpers/motionscaper-aep-fixture.ts';
import { compileInterpolationCurve, evaluateInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
test('native property times and values retain plain keys under signed source stretch', () => {
	const root = parseAepContainer(aepFile([aepList('tdgp', aepNumeric('ADBE Opacity', [0], [{ time: 0, value: [0] }, { time: 25600, value: [1] }]))]));
	const property = readAepNumeric(root[0]!.children![1], { keys: 0 })!;
	const curve = compileInterpolationCurve(aepNumericCurve(property, 0, 1, { start: 2, stretch: -1, rate: 25 })!);
	assert.equal(evaluateInterpolationCurve(curve, 25), 1); assert.equal(evaluateInterpolationCurve(curve, 37.5), 0.5); assert.equal(evaluateInterpolationCurve(curve, 50), 0);
});
test('reverse hold discontinuities are reported instead of becoming a false linear or left-held curve', () => {
	const root = parseAepContainer(aepFile([aepList('tdgp', aepNumeric('ADBE Opacity', [0], [{ time: 0, value: [0], hold: true }, { time: 25600, value: [1] }]))]));
	const property = readAepNumeric(root[0]!.children![1], { keys: 0 })!;
	assert.throws(() => aepNumericCurve(property, 0, 1, { start: 2, stretch: -1, rate: 25 }), /reverse.*hold/iu);
});
