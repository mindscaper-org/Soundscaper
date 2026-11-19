/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAepTextDictionary, aepTextAt } from '../src/common/editor/aep-text-dictionary.ts';
import { offsetAepTextAnchor } from '../src/common/editor/aep-motion-text.ts';
import { motionVector, motionPropertyOfKind } from '../src/common/editor/motion-property.ts';
import { evaluateInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
test('native text dictionary reads escaped UTF-16 strings, dictionaries and arrays without execution', () => {
	const bytes = Uint8Array.from([...new TextEncoder().encode('/0 << /1 [ 2 true /nil '), 40, 254, 255, 0, 65, 0, 92, 41, 0, 3, 0, 66, 41, ...new TextEncoder().encode(' ] >>')]);
	const data = parseAepTextDictionary(bytes);
	assert.equal(aepTextAt(data, '0', '1', 3), 'A)\u0003B'); assert.equal(aepTextAt(data, '0', '1', 0), 2);
});
test('native text box offset translates animated anchor values and temporal controls in local coordinates', () => {
	const anchor = { ...motionVector([4, 5, 0]), curves: [null, { anchors: [{ position: { num: 0, den: 1 }, value: 5 }, { position: { num: 10, den: 1 }, value: 15 }], segments: [{ kind: 'bezier' as const, control1: { position: { num: 3, den: 1 }, value: 8 }, control2: { position: { num: 7, den: 1 }, value: 12 } }] }, null] as const };
	const mapped = motionPropertyOfKind(offsetAepTextAnchor(anchor, [2, -10]), 'vector3'); assert.deepEqual(mapped.value, [2, 15, 0]);
	assert.equal(evaluateInterpolationCurve(mapped.curves[1]!, 5), evaluateInterpolationCurve(motionPropertyOfKind(anchor, 'vector3').curves[1]!, 5) + 10);
});
test('native text dictionary refuses executable tokens, duplicate keys, deep nesting and unterminated strings', () => {
	for (const value of ['/0 system', '/0 1 /0 2', '/0 (' , '/0 '+ '['.repeat(65) + ']'.repeat(65)]) assert.throws(() => parseAepTextDictionary(new TextEncoder().encode(value)));
});
