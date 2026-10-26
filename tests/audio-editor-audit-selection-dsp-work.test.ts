/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStandardEffect } from '../src/common/editor/first-party-effects/standard/dsp.ts';
import { ComplementaryCrossover } from '../src/common/editor/complementary-crossover.ts';
import { integratedLoudnessPower } from '../src/common/editor/audacity-effects/basic-loudness.js';
import { resolveVideoBurnInStage, videoBurnInUndrawableCharacters } from '../src/common/editor/video-caption-burn-in.ts';

test('fixed zero-depth Tremolo and zero-range Noise Gate return detached exact PCM without per-sample DSP', () => {
	const channels = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: 4_096 }, (_, frame) =>
		frame % 100 === 0 ? -0 : Math.sin(frame * 0.019 + channel) * 0.45));
	const cos = Math.cos, low = ComplementaryCrossover.prototype.low;
	let cosines = 0, crossovers = 0;
	Math.cos = value => { cosines++; return cos(value); };
	ComplementaryCrossover.prototype.low = function (...args) { crossovers++; return low.apply(this, args); };
	try {
		for (const [type, params] of [
			['tremolo', { depth: 0, frequency: 4, waveform: 'sine' }],
			['noise-gate', { rangeDb: 0, gateFrequency: 1_000, lookahead: 0.01 }],
		] as const) {
			const output = applyStandardEffect(type, channels, 48_000, params);
			assert.deepEqual(output, channels);
			assert.notEqual(output[0], channels[0]);
			assert.notEqual(output[1], channels[1]);
		}
		assert.equal(cosines, 0);
		assert.equal(crossovers, 0);
	} finally { Math.cos = cos; ComplementaryCrossover.prototype.low = low; }
	assert.throws(() => applyStandardEffect('noise-gate', channels, 8_000, { rangeDb: 0, gateFrequency: 5_000 }), /Nyquist/u);
	assert.throws(() => applyStandardEffect('tremolo', channels, 48_000, { depth: 0, frequency: NaN }), /frequency/u);
	assert.throws(() => applyStandardEffect('tremolo', [Float32Array.of(NaN)], 48_000, { depth: 0 }), /finite/u);
});

test('fresh silent loudness measurement skips weighting while a nonzero impulse retains exact measurement', () => {
	const channels = [new Float32Array(4_096), new Float32Array(4_096).fill(-0)];
	const impulse = [Float32Array.from({ length: 4_096 }, (_, index) => index === 2_000 ? 0.5 : 0)];
	const expected = integratedLoudnessPower(impulse, 48_000), fround = Math.fround;
	let rounds = 0;
	Math.fround = value => { rounds++; return fround(value); };
	try {
		assert.equal(integratedLoudnessPower(channels, 48_000), 0);
		assert.equal(rounds, 0);
		assert.equal(integratedLoudnessPower(impulse, 48_000), expected);
		assert.ok(rounds > 0);
	} finally { Math.fround = fround; }
});

test('missing caption glyph disclosure deduplicates in first-drawn order with bounded work', () => {
	const expected = Array.from({ length: 1_000 }, (_, index) => String.fromCodePoint(0x4e00 + index));
	const stage = resolveVideoBurnInStage(Array.from({ length: 100 }, (_, index) => ({
		startFrame: index * 48_000, endFrame: (index + 1) * 48_000,
		title: expected.slice(index * 10, index * 10 + 10).join('') + expected[0],
	})), { width: 1280, height: 720 }, 48_000);
	assert.ok(stage);
	const includes = Array.prototype.includes;
	let visits = 0;
	Object.defineProperty(Array.prototype, 'includes', { configurable: true, writable: true,
		value(this: unknown[], value: unknown, from?: number) { visits += this.length; return includes.call(this, value, from); } });
	let actual: readonly string[];
	try { actual = videoBurnInUndrawableCharacters(stage); }
	finally { Object.defineProperty(Array.prototype, 'includes', { configurable: true, writable: true, value: includes }); }
	assert.deepEqual(actual, expected);
	assert.ok(Object.isFrozen(actual));
	assert.ok(visits <= expected.length * 4, `${visits} glyph candidates`);
});
