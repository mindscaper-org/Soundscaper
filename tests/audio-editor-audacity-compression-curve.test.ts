/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audacityCompressionCurve } from '../src/common/editor/ui/audacity-compression-curve.ts';
import { audacityEffectDefaults } from '../src/common/editor/audacity-effects/manifest.js';

type Point = readonly [number, number];

function points(path: string): Point[] {
	return [...path.matchAll(/[ML]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
		.map((match) => [Number(match[1]), Number(match[2])]);
}

function yAt(line: readonly Point[], x: number): number {
	const upper = line.findIndex(point => point[0] >= x);
	assert.ok(upper > 0, 'the plotted curve spans the requested input');
	const [leftX, leftY] = line[upper - 1]!;
	const [rightX, rightY] = line[upper]!;
	return leftY + (rightY - leftY) * (x - leftX) / (rightX - leftX);
}

test('Audacity compression curve uses dB axes and closes its fill at the graph floor', () => {
	const curve = audacityCompressionCurve({ thresholdDb: -12, ratio: 4, kneeWidthDb: 0, makeupGainDb: 0 });
	const line = points(curve.line);
	assert.deepEqual(line[0], [0, 100]);
	assert.deepEqual(line.at(-1), [100, 25]);
	assert.ok(line.every(([x, y], index) => index === 0 || x > line[index - 1]![0] && y <= line[index - 1]![1]));
	assert.deepEqual(points(curve.area), [[0, 100], ...line, [100, 100]]);
	assert.ok(curve.area.endsWith(' Z'));
});

test('Audacity soft knee bends below the hard knee around the threshold', () => {
	const hard = points(audacityCompressionCurve({ thresholdDb: -18, ratio: 4, kneeWidthDb: 0, makeupGainDb: 0 }).line);
	const soft = points(audacityCompressionCurve({ thresholdDb: -18, ratio: 4, kneeWidthDb: 12, makeupGainDb: 0 }).line);
	assert.deepEqual(soft[0], hard[0]);
	assert.deepEqual(soft.at(-1), hard.at(-1));
	// At -18 dB, a 12 dB knee and 4:1 ratio reduce the output by 1.125 dB.
	const thresholdOutput = yAt(soft, 50);
	assert.ok(Math.abs(thresholdOutput - 53.125) < 0.2);
	assert.ok(thresholdOutput > yAt(hard, 50));
});

test('compressor makeup shifts the whole curve without flattening values above the graph', () => {
	const line = points(audacityCompressionCurve({ thresholdDb: -12, ratio: 1, kneeWidthDb: 6, makeupGainDb: 9 }).line);
	assert.deepEqual(line[0], [0, 75]);
	assert.deepEqual(line.at(-1), [100, -25]);
});

test('omitted compressor parameters use the current effect defaults', () => {
	const defaultCurve = audacityCompressionCurve({});
	assert.deepEqual(defaultCurve, audacityCompressionCurve(audacityEffectDefaults('audacity-compressor')));
});
