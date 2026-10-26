/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCurveResponse, filterCurveKernelGain } from '../src/common/editor/audacity-effects/filter-curve-response.ts';
import { buildEqualizationKernel } from '../src/common/editor/audacity-effects/spectral-equalization-curves.js';
import { filterCurveGain } from '../src/common/editor/audacity-effects/filter-curve.ts';

test('changing an EQ curve reuses its bounded frequency basis with exact gains and geometry invalidation', async context => {
	const frequencies = [20, 123.45, 400, 1_000, 12_345];
	const originalSin = Math.sin;
	let evaluations = 0;
	context.mock.method(Math, 'sin', (value: number) => { evaluations += 1; return originalSin(value); });
	const points = (gain: number) => [{ frequency: 20, gain: 0 }, { frequency: 1_000, gain }, { frequency: 20_000, gain: 0 }];
	await filterCurveResponse(points(0), 48_000, 127, false, frequencies);
	assert.ok(evaluations > 0);
	evaluations = 0;
	const actual = await filterCurveResponse(points(3.5), 48_000, 127, false, frequencies);
	assert.equal(evaluations, 0, 'changing coefficients does not rebuild geometry');
	frequencies[2] = 401;
	await filterCurveResponse(points(4), 48_000, 127, false, frequencies);
	assert.ok(evaluations > 0, 'mutating caller geometry replaces the prepared basis');
	context.mock.restoreAll();
	const kernel = buildEqualizationKernel(48_000, 127, (frequency: number) => filterCurveGain(points(3.5), frequency, false));
	assert.deepEqual(actual.map(point => point.gain), [20, 123.45, 400, 1_000, 12_345].map(frequency => filterCurveKernelGain(kernel, frequency, 48_000)));
});
