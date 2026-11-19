/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { dawprojectImportedVolumeCurve } from '../src/common/editor/dawproject-import-volume-curve.ts';

test('the legacy volume envelope interpolates the origin in the declared decibel unit', () => {
	const points = dawprojectImportedVolumeCurve([
		{ frame: -48_000, value: -20, interpolation: 'linear' },
		{ frame: 48_000, value: 0, interpolation: 'hold' },
	], 'decibel', 4);
	assert.equal(points[0]?.frame, 0);
	assert.ok(Math.abs(points[0]!.value - 10 ** (-10 / 20)) < 1e-12);
	assert.deepEqual(points.at(-1), { frame: 48_000, value: 1 });
});

test('a held pre-origin point and an authored origin retain their respective values', () => {
	const before = { frame: -48_000, value: 0.25, interpolation: 'hold' } as const;
	const after = { frame: 48_000, value: 1, interpolation: 'linear' } as const;
	assert.deepEqual(dawprojectImportedVolumeCurve([after, before], 'linear', 4), [
		{ frame: 0, value: 0.25 }, { frame: 48_000, value: 1 },
	]);
	assert.deepEqual(dawprojectImportedVolumeCurve([before], 'linear', 4), [{ frame: 0, value: 0.25 }]);
	assert.deepEqual(dawprojectImportedVolumeCurve([
		before, { frame: 0, value: 0.75, interpolation: 'hold' }, after,
	], 'linear', 4), [{ frame: 0, value: 0.75 }, { frame: 48_000, value: 1 }]);
});

test('a decibel ramp from infinite silence uses the same linear gain origin as the native lane', () => {
	const points = dawprojectImportedVolumeCurve([
		{ frame: -48_000, value: Number.NEGATIVE_INFINITY, interpolation: 'linear' },
		{ frame: 48_000, value: 0, interpolation: 'hold' },
	], 'decibel', 4);
	assert.deepEqual(points, [{ frame: 0, value: 0.5 }, { frame: 48_000, value: 1 }]);
});
