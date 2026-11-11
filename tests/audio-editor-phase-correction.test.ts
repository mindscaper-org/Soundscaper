/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePhaseCorrection, applyPhaseCorrection } from '../src/common/editor/first-party-effects/phase-correction/selection.ts';
import { normalizePhaseCorrectionParams } from '../src/common/editor/first-party-effects/phase-correction/definition.ts';
import { phaseCorrectionPeakBytes } from '../src/common/editor/first-party-effects/phase-correction/contract.ts';
import { audioEffectTypes, audioSelectionEffectTypes, audioSelectionEffectLabel, audioSelectionEffectDefaults,
	normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { applyAudioSelectionEffectAsync, estimateAudioSelectionEffectOutputFrames,
	estimateAudioSelectionEffectPeakBytes } from '../src/common/editor/selection-effects.js';
import { EFFECT_MENU_GROUPS } from '../src/common/editor/ui/application-menu-model.js';

const RATE = 48000;
const TYPE = 'automatic-phase-correction';

function noise(frames: number, seed = 37): Float32Array {
	return Float32Array.from({ length: frames }, () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
		return seed / 2 ** 32;
	});
}

function delayed(input: Float32Array, frames: number): Float32Array {
	return input.map((_, frame) => input[frame - frames] ?? 0);
}

function signal(frame: number, rate: number): number {
	let value = 0;
	for (let index = 0; index < 29; index++) {
		const frequency = 173 + index * 173.17 + index ** 2 * 1.733;
		value += Math.sin(frame / rate * frequency * Math.PI * 2 + index ** 2) / 100;
	}
	return value;
}

test('automatic phase correction is a selection-only repair with validated controls and memory admission', () => {
	assert.ok(audioSelectionEffectTypes().includes(TYPE));
	assert.ok(!audioEffectTypes().includes(TYPE));
	assert.equal(audioSelectionEffectLabel(TYPE), 'Automatic phase correction');
	assert.ok(EFFECT_MENU_GROUPS.find(([name]) => name === 'noiseRepair')?.[1].includes(TYPE));
	assert.deepEqual(audioSelectionEffectDefaults(TYPE), { reference: 'left', maximumShiftMs: 5, minimumConfidence: 85 });
	assert.deepEqual(normalizeAudioSelectionEffectParams(TYPE, { reference: 'right' }), normalizePhaseCorrectionParams({ reference: 'right' }));
	for (const params of [{ reference: 'both' }, { maximumShiftMs: -1 }, { maximumShiftMs: 11 },
		{ maximumShiftMs: NaN }, { minimumConfidence: 49 }, { minimumConfidence: 101 }]) {
		assert.throws(() => normalizePhaseCorrectionParams(params), RangeError);
	}
	assert.equal(estimateAudioSelectionEffectOutputFrames(TYPE, RATE), RATE);
	assert.ok(estimateAudioSelectionEffectPeakBytes(TYPE, RATE, {}, { sampleRate: RATE, channelCount: 2 }) >= RATE * 2 * 4 * 4);
	for (const options of [{ channelCount: 1 }, { channelCount: 3 }, { sampleRate: 0 }, { sampleRate: 384001 }]) {
		assert.throws(() => phaseCorrectionPeakBytes(RATE, options), RangeError);
	}
	for (const frames of [0, 1.5, Number.MAX_SAFE_INTEGER]) assert.throws(() => phaseCorrectionPeakBytes(frames), RangeError);
});

test('known positive and negative integer offsets align at every supported clock and keep the reference exact', async () => {
	for (const rate of [8000, 44100, 48000, 96000, 192000, 384000]) for (const lag of [-7, 12]) {
		const left = noise(Math.round(rate / 3));
		const right = delayed(left, lag);
		const original = right.slice();
		const analysis = await analyzePhaseCorrection([left, right], rate);
		assert.equal(analysis.status, 'correctable', `${rate} Hz, ${lag} samples: ${JSON.stringify(analysis)}`);
		assert.ok(Math.abs(analysis.lagSamples - lag) < .05);
		const output = await applyPhaseCorrection([left, right], rate);
		assert.equal(output.length, 2);
		assert.equal(output[1]!.length, right.length);
		assert.deepEqual(output[0], left);
		assert.notEqual(output[0], left);
		for (let frame = 128; frame < left.length - 128; frame++) assert.equal(output[1]![frame], left[frame]);
		assert.equal(output[1]![0], right[0]);
		assert.equal(output[1]!.at(-1), right.at(-1));
		assert.deepEqual(right, original);
		const anchoredRight = await applyPhaseCorrection([left, right], rate, { reference: 'right' });
		assert.deepEqual(anchoredRight[1], right);
		for (let frame = 128; frame < left.length - 128; frame++) assert.equal(anchoredRight[0]![frame], right[frame]);
	}
});

test('fractional alignment restores shared transients without changing gain or duration', async () => {
	for (const lag of [-6.25, 12.4]) {
		const left = Float32Array.from({ length: RATE }, (_, frame) => signal(frame, RATE) + .12);
		const right = Float32Array.from(left, (_, frame) => .4 * signal(frame - lag, RATE) - .07);
		const analysis = await analyzePhaseCorrection([left, right], RATE);
		assert.equal(analysis.status, 'correctable', JSON.stringify(analysis));
		assert.ok(Math.abs(analysis.lagSamples - lag) < .08, String(analysis.lagSamples));
		const output = await applyAudioSelectionEffectAsync(TYPE, [left, right], RATE);
		let error = 0, energy = 0;
		for (let frame = 128; frame < RATE - 128; frame++) {
			const expected = .4 * signal(frame, RATE) - .07;
			error += (output[1]![frame]! - expected) ** 2;
			energy += (expected + .07) ** 2;
		}
		assert.ok(Math.sqrt(error / energy) < .02, `relative RMS error ${Math.sqrt(error / energy)}`);
		assert.deepEqual(output[0], left);
	}
});

test('silence, DC, short, already aligned, unrelated, periodic and inverted material remain unchanged', async () => {
	const left = noise(RATE);
	const periodic = Float32Array.from({ length: RATE }, (_, frame) => Math.sin(frame * Math.PI * 2 / 48));
	const pairs = [
		[new Float32Array(RATE), new Float32Array(RATE)],
		[new Float32Array(RATE).fill(.2), new Float32Array(RATE).fill(-.3)],
		[noise(64), delayed(noise(64), 4)],
		[left, left.slice()],
		[left, noise(RATE, 814)],
		[left.map(sample => sample * 1e-6), delayed(left, 12).map(sample => sample * 1e-6)],
		[periodic, delayed(periodic, 6)],
		[left, delayed(left, 12).map(value => -value)],
	];
	for (const pair of pairs) {
		const analysis = await analyzePhaseCorrection(pair, RATE);
		assert.notEqual(analysis.status, 'correctable', JSON.stringify(analysis));
		assert.deepEqual(await applyPhaseCorrection(pair, RATE), pair);
	}
});

test('conflicting timing across the selection and offsets outside the limit are not forced into alignment', async () => {
	const left = noise(RATE * 2);
	const moving = left.map((_, frame) => left[frame - (frame < RATE ? 12 : 30)] ?? 0);
	assert.notEqual((await analyzePhaseCorrection([left, moving], RATE)).status, 'correctable');
	const right = delayed(left, 120);
	assert.deepEqual(await applyPhaseCorrection([left, right], RATE, { maximumShiftMs: 1 }), [left, right]);
	assert.deepEqual(await applyPhaseCorrection([left, right], RATE, { maximumShiftMs: 0 }), [left, right]);
});

test('phase processing validates PCM and honors cancellation before publishing output', async () => {
	for (const pair of [[noise(512)], [noise(512), noise(511)], [noise(512), noise(512), noise(512)],
		[new Float32Array([NaN]), new Float32Array([0])]]) {
		await assert.rejects(applyPhaseCorrection(pair, RATE));
	}
	await assert.rejects(applyPhaseCorrection([noise(512), noise(512)], 0), RangeError);
	await assert.rejects(applyAudioSelectionEffectAsync(TYPE, [noise(512), noise(512)], RATE, {}, {
		spectralSelection: { minimumFrequency: 100, maximumFrequency: 1000, windowSize: 256 },
	}), /full-spectrum/);
	await assert.rejects(applyPhaseCorrection([noise(512), noise(512)], RATE, {}, { isCancelled: () => true }), { name: 'AbortError' });
	let progress = 0;
	await assert.rejects(applyPhaseCorrection([noise(RATE), delayed(noise(RATE), 12)], RATE, {}, {
		onProgress: value => { progress = value; }, isCancelled: () => progress > .1,
	}), { name: 'AbortError' });
});
