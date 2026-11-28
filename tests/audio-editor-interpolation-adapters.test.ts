/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import { createEnvelopeValueEvaluator } from '../src/common/editor/automation.js';
import { createBreakpointMapEvaluator, evaluateBreakpointMap } from '../src/common/editor/timeline-time.ts';
import { compileVideoRetimeCurve, evaluateVideoRetimeCurve } from '../src/common/editor/video-retime-curve.ts';

const rational = (num: number, den = 1) => ({ num, den });

test('the retired interpolation adapters are absent', async () => {
	await assert.rejects(access(new URL('../src/common/editor/interpolation-adapters.ts', import.meta.url)), { code: 'ENOENT' });
});

test('the playback envelope starts at unity and holds the final authored value', () => {
	const points = [
		{ frame: 4, value: 0.5 },
		{ frame: 10, value: 1.5 },
		{ frame: 16, value: 0.25 },
	];
	const evaluate = createEnvelopeValueEvaluator(points, 20);
	assert.deepEqual(
		[0, 2, 4, 7, 10, 13, 16, 18, 20, 25].map(evaluate),
		[1, 0.75, 0.5, 1, 1.5, 0.875, 0.25, 0.25, 0.25, 0.25],
	);
	assert.throws(() => evaluate(-5), /non-negative/u);
	assert.deepEqual([0, 10, 20].map(createEnvelopeValueEvaluator([], 20)), [1, 1, 1]);
});

test('the playback envelope keeps all 4096 authored points between implicit endpoints', () => {
	const duration = 4_097;
	const points = Array.from({ length: 4_096 }, (_, index) => ({
		frame: index + 1,
		value: (index % 16) / 16,
	}));
	const evaluate = createEnvelopeValueEvaluator(points, duration);
	assert.equal(evaluate(0), 1);
	for (const { frame, value } of points) assert.equal(evaluate(frame), value);
	assert.equal(evaluate(duration), 15 / 16);
});

test('the playback envelope preserves finite interpolation operation ordering exactly', () => {
	let state = 0x75_21_88_43;
	const random = () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_00_00_00_00;
	};
	const fixtures = [
		[0.00012522190815080977, 4.440201567690913] as const,
		...Array.from({ length: 256 }, () => [random() * 16, random() * 16] as const),
	];
	for (const [first, last] of fixtures) {
		const evaluate = createEnvelopeValueEvaluator([{ frame: 0, value: first }, { frame: 4, value: last }], 4);
		for (const frame of [1, 2, 3]) {
			assert.equal(evaluate(frame), first + (last - first) * (frame / 4));
		}
	}
});

test('breakpoint maps preserve linear audio warp and frozen or reversed video spans', () => {
	const audio = {
		feature: 'audio-warp',
		points: [
			{ outer: rational(0), source: rational(2), mode: 'forward' },
			{ outer: rational(3), source: rational(8), mode: 'forward' },
			{ outer: rational(7), source: rational(10), mode: 'forward' },
		],
	} as const;
	const video = {
		feature: 'video-retime',
		points: [
			{ outer: rational(0), source: rational(2), mode: 'forward' },
			{ outer: rational(2), source: rational(6), mode: 'freeze' },
			{ outer: rational(4), source: rational(6), mode: 'reverse' },
			{ outer: rational(8), source: rational(2), mode: 'forward' },
		],
	} as const;
	const queries = [rational(-1), rational(0), rational(1), rational(5, 2), rational(4), rational(7), rational(9)];
	assert.deepEqual(queries.map(query => evaluateBreakpointMap(audio, query)),
		[rational(2), rational(2), rational(4), rational(7), rational(17, 2), rational(10), rational(10)]);
	assert.deepEqual(queries.map(query => evaluateBreakpointMap(video, query)),
		[rational(2), rational(2), rational(4), rational(6), rational(6), rational(3), rational(2)]);
});

test('breakpoint evaluation preserves signed coordinates and maximum denominators', () => {
	const maximum = Number.MAX_SAFE_INTEGER;
	const signed = {
		feature: 'video-retime',
		points: [
			{ outer: rational(-7, 3), source: rational(-5, 7), mode: 'forward' },
			{ outer: rational(-1, 3), source: rational(9, 7), mode: 'freeze' },
			{ outer: rational(5, 3), source: rational(9, 7), mode: 'reverse' },
			{ outer: rational(8, 3), source: rational(-2, 7), mode: 'forward' },
		],
	} as const;
	const identity = {
		feature: 'audio-warp',
		points: [
			{ outer: rational(0), source: rational(0), mode: 'forward' },
			{ outer: rational(1, maximum), source: rational(1, maximum), mode: 'forward' },
			{ outer: rational(1, 1_000_001), source: rational(1, 1_000_001), mode: 'forward' },
			{ outer: rational(1), source: rational(1), mode: 'forward' },
		],
	} as const;
	const signedQueries = [rational(-3), rational(-7, 3), rational(-4, 3), rational(-1, 3),
		rational(2, 3), rational(5, 3), rational(2), rational(3)];
	const identityQueries = [rational(0), rational(1, maximum), rational(1, 2_000_002), rational(1, 1_000_001), rational(1)];
	assert.deepEqual(signedQueries.map(createBreakpointMapEvaluator(signed)),
		[rational(-5, 7), rational(-5, 7), rational(2, 7), rational(9, 7),
			rational(9, 7), rational(9, 7), rational(16, 21), rational(-2, 7)]);
	assert.deepEqual(identityQueries.map(createBreakpointMapEvaluator(identity)), identityQueries);
});

test('generated breakpoint positions agree with exact integer span weights', () => {
	let state = 0x31_05_a7_19;
	const randomInteger = (maximum: number) => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state % maximum;
	};
	for (let fixture = 0; fixture < 256; fixture += 1) {
		const outerStart = randomInteger(41) - 20;
		const outerMiddle = outerStart + 1 + randomInteger(20);
		const outerEnd = outerMiddle + 1 + randomInteger(20);
		const sourceStart = randomInteger(41) - 20;
		const sourceMiddle = sourceStart + 1 + randomInteger(20);
		const sourceEnd = sourceMiddle + 1 + randomInteger(20);
		const map = {
			feature: 'audio-warp',
			points: [
				{ outer: rational(outerStart, 7), source: rational(sourceStart, 11), mode: 'forward' },
				{ outer: rational(outerMiddle, 7), source: rational(sourceMiddle, 11), mode: 'forward' },
				{ outer: rational(outerEnd, 7), source: rational(sourceEnd, 11), mode: 'forward' },
			],
		} as const;
		const evaluate = createBreakpointMapEvaluator(map);
		for (let queryIndex = 0; queryIndex < 32; queryIndex += 1) {
			const tick = outerStart * 13 + randomInteger((outerEnd - outerStart) * 13 + 1);
			const [lower, upper, sourceLeft, sourceRight] = tick <= outerMiddle * 13
				? [outerStart * 13, outerMiddle * 13, sourceStart, sourceMiddle]
				: [outerMiddle * 13, outerEnd * 13, sourceMiddle, sourceEnd];
			const numerator = sourceLeft * (upper - tick) + sourceRight * (tick - lower);
			const denominator = 11 * (upper - lower);
			const actual = evaluate(rational(tick, 91));
			assert.equal(actual.num * denominator, numerator * actual.den);
		}
	}
});

test('V2 retime evaluation integrates constant, freeze, forward and reverse segments exactly', () => {
	const input = {
		version: 2 as const,
		outerFrameCount: 12,
		sourceStartFrame: 0,
		sourceFrameCount: 20,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0) },
			{ outerFrame: 2, sourceFrame: rational(2) },
			{ outerFrame: 4, sourceFrame: rational(2) },
			{ outerFrame: 8, sourceFrame: rational(10) },
			{ outerFrame: 12, sourceFrame: rational(2) },
		],
		segments: [
			{ mode: 'constant-forward' as const },
			{ mode: 'freeze' as const },
			{ mode: 'ramp-forward' as const, startVelocity: rational(4), endVelocity: rational(0) },
			{ mode: 'ramp-reverse' as const, startVelocity: rational(0), endVelocity: rational(4) },
		],
	};
	const before = structuredClone(input);
	const curve = compileVideoRetimeCurve(input);
	const eighths = [0, 4, 8, 12, 16, 16, 16, 16, 16, 31, 44, 55, 64, 71, 76, 79, 80, 79, 76, 71, 64, 55, 44, 31, 16];
	for (const [halfFrame, expected] of eighths.entries()) {
		const outer = halfFrame % 2 === 0 ? rational(halfFrame / 2) : rational(halfFrame, 2);
		const actual = evaluateVideoRetimeCurve(curve, outer);
		assert.equal(actual.numerator * 8n, BigInt(expected) * actual.denominator);
	}
	assert.deepEqual(input, before, 'evaluation does not rewrite the existing wire');
});

test('V2 ramps preserve exact fractional positions across a maximum-safe interval', () => {
	const maximum = Number.MAX_SAFE_INTEGER;
	const curve = compileVideoRetimeCurve({
		version: 2,
		outerFrameCount: maximum,
		sourceStartFrame: 0,
		sourceFrameCount: 1,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0) },
			{ outerFrame: maximum, sourceFrame: rational(1) },
		],
		segments: [{ mode: 'ramp-forward', startVelocity: rational(0), endVelocity: rational(2, maximum) }],
	});
	for (const outer of [rational(0), rational(1, 2), rational(1), rational(1_000_001, 2),
		rational(Math.floor(maximum / 2)), rational(maximum - 1), rational(maximum)]) {
		const actual = evaluateVideoRetimeCurve(curve, outer);
		// A zero-to-2/length velocity ramp covers the square of its normalized position.
		const numerator = BigInt(outer.num) ** 2n;
		const denominator = (BigInt(outer.den) * BigInt(maximum)) ** 2n;
		assert.equal(actual.numerator * denominator, numerator * actual.denominator);
	}
});
