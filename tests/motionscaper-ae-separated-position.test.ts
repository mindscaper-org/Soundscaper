/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { convertMotionAeTransform } from '../src/common/editor/motion-ae-transform-conversion.ts';
import { convertMotionAeSeparatedPosition } from '../src/common/editor/motion-ae-position-conversion.ts';
import { normalizeMotionAeProperties } from '../src/common/editor/motion-ae-property-custody.ts';
import { convertMotionAeNumericProperty } from '../src/common/editor/motion-ae-property-conversion.ts';
import type { MotionAeLayer, MotionAeProperty, MotionAeReportEntry } from '../src/common/editor/motion-ae-exchange-types.ts';
import { createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { evaluateInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';

const numeric = (matchName: string, value: readonly number[]): Extract<MotionAeProperty, { kind: 'numeric' }> => ({ kind: 'numeric', matchName, name: matchName, value, spatial: false, keys: [], expression: null });
const key = (time: number, value: number) => ({ time, value: [value], inInterpolation: 'linear' as const, outInterpolation: 'linear' as const,
	inEase: [{ speed: 0, influence: 33 }], outEase: [{ speed: 0, influence: 33 }], inSpatialTangent: null, outSpatialTangent: null, roving: false });
function channels(separated = true): readonly MotionAeProperty[] {
	return [{ ...numeric('ADBE Position', [999, 888]), dimensionsSeparated: separated },
		{ ...numeric('ADBE Position_0', [10]), keys: [key(0, 10), key(2, 30)] },
		{ ...numeric('ADBE Position_1', [20]), keys: [{ ...key(0, 20), outInterpolation: 'hold' }, key(1, 40)] }];
}
function convert(children: readonly MotionAeProperty[]) {
	const layer: MotionAeLayer = { id: 'separated', name: 'Independent axes', kind: 'null', sourceId: null, parentId: null, matte: null,
		startTime: 0, inPoint: 0, outPoint: 2, stretch: 100, enabled: true, threeD: false, adjustment: false, blendMode: 'normal',
		properties: [{ kind: 'group', matchName: 'ADBE Transform Group', name: 'Transform', children: normalizeMotionAeProperties(children, { properties: 0, keys: 0 }) }] };
	const report: MotionAeReportEntry[] = [], base = createMotionLayer({ id: 'destination', name: 'Destination', durationFrames: 48, content: { kind: 'null' } });
	return { transform: convertMotionAeTransform(layer, { num: 24, den: 1 }, base.transform, report, 48), report };
}
test('AE separated Position uses independent authored axis curves instead of stale combined values', () => {
	const input = channels(), { transform, report } = convert(input), { position } = transform;
	assert.deepEqual(position.value, [10, 20, 0]);
	assert.equal(evaluateInterpolationCurve(position.curves[0]!, 12), 15);
	assert.equal(evaluateInterpolationCurve(position.curves[1]!, 12), 20);
	assert.equal(evaluateInterpolationCurve(position.curves[1]!, 24), 40);
	assert.deepEqual(position.curves[0]!.anchors.map(anchor => anchor.position), [{ num: 0, den: 1 }, { num: 48, den: 1 }]);
	assert.equal(position.curves[2], null);
	assert.ok(report.some(entry => entry.code === 'position-separation' && entry.status === 'editable'));
	assert.deepEqual(input[0]!.kind === 'numeric' && input[0].value, [999, 888]);
});
test('AE inactive separated followers cannot replace a captured combined Position', () => {
	const { transform } = convert(channels(false));
	assert.deepEqual(transform.position.value, [999, 888, 0]);
	assert.deepEqual(transform.position.curves, [null, null, null]);
});
test('AE ambiguous or incomplete separated Position never uses stale combined coordinates', () => {
	const source = channels(), leader = source[0]!;
	if (leader.kind !== 'numeric') throw new Error('Expected Position.');
	for (const children of [
		[numeric('ADBE Position', [999, 888]), ...source.slice(1)],
		[source[0]!, source[1]!],
		[...source, source[1]!],
		[source[0]!, source[1]!, { ...numeric('ADBE Position_1', [20]), keys: [{ ...key(0, 20), outInterpolation: 'bezier' as const }, key(1, 40)] }],
		[source[0]!, source[1]!, { ...numeric('ADBE Position_1', [20]), expression: { enabled: true, source: 'arbitraryCode()', disposition: 'unsupported' as const } }],
	]) {
		const { transform, report } = convert(children);
		assert.deepEqual(transform.position.value, [0, 0, 0]);
		assert.ok(report.some(entry => entry.code === 'position-separation' && entry.status === 'unsupported'));
	}
	assert.equal(convertMotionAeNumericProperty(leader, { frameRate: { num: 24, den: 1 }, axes: [0, 1, null], defaults: [0, 0, 0], scale: 1 }).property, null);
});
test('AE separation metadata stays optional and is admitted only on a numeric Position leader', () => {
	assert.deepEqual(normalizeMotionAeProperties(channels(), { properties: 0, keys: 0 }), channels());
	const legacy = numeric('ADBE Position', [1, 2]);
	assert.deepEqual(normalizeMotionAeProperties([legacy], { properties: 0, keys: 0 }), [legacy]);
	for (const property of [{ ...numeric('ADBE Opacity', [100]), dimensionsSeparated: true },
		{ ...legacy, dimensionsSeparated: 'yes' }, { ...numeric('ADBE Position', [1]), dimensionsSeparated: true }]) {
		assert.throws(() => normalizeMotionAeProperties([property], { properties: 0, keys: 0 }), /separat|dimension|boolean/iu);
	}
});

test('AE separated Position samples require full active coverage and keep the third axis independent', () => {
	const properties = normalizeMotionAeProperties([
		{ ...numeric('ADBE Position', [999, 888, 777]), dimensionsSeparated: true },
		{ ...numeric('ADBE Position_0', [10]), samples: { frameRate: 1, firstFrame: 0, values: [[10], [20], [30]] } },
		numeric('ADBE Position_1', [40]), numeric('ADBE Position_2', [50]),
	], { properties: 0, keys: 0 });
	const result = convertMotionAeSeparatedPosition(properties, { num: 24, den: 1 }, [0, 2]);
	assert.equal(result?.status, 'sampled'); assert.equal(result.property?.kind, 'vector3');
	if (result.property?.kind !== 'vector3') throw new Error('Expected Position.');
	assert.deepEqual(result.property.value, [10, 40, 50]);
	assert.equal(evaluateInterpolationCurve(result.property.curves[0]!, 12), 15);
	assert.deepEqual(result.property.curves.slice(1), [null, null]);
	assert.equal(convertMotionAeSeparatedPosition(properties, { num: 24, den: 1 }, [0, 3])?.status, 'unsupported');
});
