/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLinearColorGradeChannels } from '../src/common/imaging/linear-color-grade.ts';
import { parseCubeLutV1, requireCubeLutBody, sampleCubeLut } from '../src/common/imaging/cube-lut-v1.ts';
import { rasterizeCubicMaskPaths, type CubicMaskPath } from '../src/common/imaging/mask-path-raster.ts';

const grade = {
	exposureStops: 1, contrast: 1, pivot: 0.18,
	lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1,
} as const;

function rectangle(left: number, top: number, right: number, bottom: number, closed = true): CubicMaskPath {
	return { closed, points: [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => ({
		position: { x: x!, y: y! }, inHandle: null, outHandle: null,
	})) };
}

test('image grading accepts an admitted grade without project identity and preserves linear arithmetic', () => {
	const source = Object.freeze([1, 0.5, 0.25]);
	assert.deepEqual(applyLinearColorGradeChannels(source, grade), [2, 1, 0.5]);
	const neutral = applyLinearColorGradeChannels(source, { ...grade, saturation: 0 });
	for (const channel of neutral) assert.ok(Math.abs(channel - 1.1765) < 1e-12);
	assert.deepEqual(source, [1, 0.5, 0.25]);
});

test('shared mask rasterization preserves pixel centres, open contours, and fill-rule holes', () => {
	const outer = rectangle(0, 0, 1, 1, false);
	const inner = rectangle(0.25, 0.25, 0.75, 0.75);
	assert.deepEqual([...rasterizeCubicMaskPaths([outer, inner], 'even-odd', 4, 4)], [
		255, 255, 255, 255,
		255, 0, 0, 255,
		255, 0, 0, 255,
		255, 255, 255, 255,
	]);
	assert.ok(rasterizeCubicMaskPaths([outer, inner], 'nonzero', 4, 4).every(value => value === 255));
	assert.deepEqual([...rasterizeCubicMaskPaths([], 'nonzero', 2, 2)], [0, 0, 0, 0]);
});

test('shared cubic rasterization resolves curved contours independently of a timeline graph', () => {
	const lens: CubicMaskPath = { closed: true, points: [
		{ position: { x: 0.5, y: 0 }, inHandle: { x: 0, y: 0 }, outHandle: { x: 1, y: 0 } },
		{ position: { x: 0.5, y: 1 }, inHandle: { x: 1, y: 1 }, outHandle: { x: 0, y: 1 } },
	] };
	assert.deepEqual([...rasterizeCubicMaskPaths([lens], 'nonzero', 8, 4)], [
		0, 0, 255, 255, 255, 255, 0, 0,
		0, 255, 255, 255, 255, 255, 255, 0,
		0, 255, 255, 255, 255, 255, 255, 0,
		0, 0, 255, 255, 255, 255, 0, 0,
	]);
});

test('shared cube LUT sampling retains red-fastest lattice order and authenticates resource references', () => {
	const lut = parseCubeLutV1('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
	const sample = sampleCubeLut(lut, [0.2, 0.6, 0.8]);
	for (const [index, expected] of [0.2, 0.6, 0.8].entries()) assert.ok(Math.abs(sample[index]! - expected) < 1e-12);
	const reference = { storageKey: `lut-sha256:${lut.sha256}`, sha256: lut.sha256,
		byteLength: lut.byteLength, size: lut.size, domainMin: lut.domainMin, domainMax: lut.domainMax };
	assert.equal(requireCubeLutBody(reference, lut), lut);
	assert.throws(() => requireCubeLutBody({ ...reference, sha256: '0'.repeat(64) }, lut), /does not match/u);
	assert.throws(() => requireCubeLutBody(reference, { ...lut }), /verified/u);
});
