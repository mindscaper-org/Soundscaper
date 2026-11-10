/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadStaffPadWasm } from '../src/common/editor/staffpad/runtime.js';
import { audioEffectTypes, audioSelectionEffectTypes, audioSelectionEffectDefaults,
	audioSelectionEffectLabel, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { estimateAudioSelectionEffectOutputFrames, estimateAudioSelectionEffectPeakBytes,
	applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { createAutoTunePitchDetector, nearestAutoTuneNote } from '../src/common/editor/first-party-effects/auto-tune/pitch.ts';
import { applyAutoTune } from '../src/common/editor/first-party-effects/auto-tune/selection.ts';
import { EFFECT_MENU_GROUPS } from '../src/common/editor/ui/application-menu-model.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { nativeEffectParameterLabel } from '../src/common/editor/ui/effect-parameter-labels.ts';
import { nativeEffectOptionLabel } from '../src/common/editor/ui/inspector/effect-helpers.ts';

const RATE = 48000;
const TYPE = 'auto-tune';
const tone = (frequency: number, rate = RATE, seconds = 1, amplitude = .3) =>
	Float32Array.from({ length: Math.round(rate * seconds) }, (_, frame) => amplitude * Math.sin(2 * Math.PI * frequency * frame / rate));
const runtime = () => readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)).then(loadStaffPadWasm);

test('Auto-Tune supports selection and rack effects with validated musical controls and bounded admission', () => {
	assert.ok(audioSelectionEffectTypes().includes(TYPE));
	assert.ok(audioEffectTypes().includes(TYPE));
	assert.equal(audioSelectionEffectLabel(TYPE), 'Auto-Tune');
	assert.ok(EFFECT_MENU_GROUPS.some(([, types]) => types.includes(TYPE)));
	assert.equal(nativeEffectParameterLabel(TYPE, 'retune', ENGLISH_COPY), 'Retune speed');
	assert.equal(nativeEffectOptionLabel(TYPE, 'key', 'c-sharp', ENGLISH_COPY), 'C♯ / D♭');
	assert.equal(nativeEffectOptionLabel(TYPE, 'scale', 'minor', ENGLISH_COPY), 'Natural minor');
	assert.deepEqual(audioSelectionEffectDefaults(TYPE), { amount: 100, retune: 20, mix: 100, key: 'c', scale: 'chromatic' });
	for (const params of [{ key: 'h' }, { scale: 'invalid' }, { amount: 101 }, { retune: -1 }, { mix: NaN }]) {
		assert.throws(() => normalizeAudioSelectionEffectParams(TYPE, params), RangeError);
	}
	assert.equal(estimateAudioSelectionEffectOutputFrames(TYPE, RATE), RATE);
	assert.ok(estimateAudioSelectionEffectPeakBytes(TYPE, RATE, {}, { sampleRate: RATE, channelCount: 2 }) > 64 * 1024 ** 2);
	assert.throws(() => estimateAudioSelectionEffectPeakBytes(TYPE, RATE, {}, { sampleRate: 384000 }), RangeError);
	assert.throws(() => estimateAudioSelectionEffectPeakBytes(TYPE, RATE, {}, { channelCount: 33 }), RangeError);
	assert.throws(() => estimateAudioSelectionEffectOutputFrames(TYPE, 0), RangeError);
	assert.throws(() => estimateAudioSelectionEffectPeakBytes(TYPE, Number.MAX_SAFE_INTEGER), RangeError);
});

test('musical snapping follows chromatic, major and natural minor scales across octaves', () => {
	assert.equal(nearestAutoTuneNote(69.35, 'c', 'chromatic'), 69);
	assert.equal(nearestAutoTuneNote(61.3, 'c', 'major'), 62);
	assert.equal(nearestAutoTuneNote(63.2, 'c', 'minor'), 63);
	assert.equal(nearestAutoTuneNote(61.2, 'a', 'minor'), 62);
	assert.equal(nearestAutoTuneNote(71.8, 'b', 'major'), 71);
	assert.equal(nearestAutoTuneNote(59.8, 'c-sharp', 'major'), 60);
});

test('pitch detection handles vocal ranges, harmonics, DC and opposite-phase stereo', () => {
	for (const rate of [8000, 44100, 48000, 96000, 192000]) for (const frequency of [70, 220, 453, 1000]) {
		const input = tone(frequency, rate, .12);
		const other = input.map(value => -value);
		const detected = createAutoTunePitchDetector([input, other], rate)(Math.round(rate * .06));
		assert.ok(Math.abs(1200 * Math.log2(detected / frequency)) < 8, `${rate} Hz: expected ${frequency}, detected ${detected}`);
	}
	const harmonic = tone(180).map((value, frame) => .15 + value + .2 * Math.sin(2 * Math.PI * 360 * frame / RATE));
	assert.ok(Math.abs(createAutoTunePitchDetector([harmonic], RATE)(24000) - 180) < 1);
	for (const frequency of [50, 2000]) assert.equal(createAutoTunePitchDetector([tone(frequency)], RATE)(24000), 0);
	assert.equal(createAutoTunePitchDetector([new Float32Array(RATE).fill(.1)], RATE)(24000), 0);
	let seed = 17;
	const noise = Float32Array.from({ length: RATE }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed / 2 ** 32; });
	assert.equal(createAutoTunePitchDetector([noise], RATE)(24000), 0);
});

test('zero amount/mix, silence, noise and short selections preserve exact PCM without loading WASM', async () => {
	const input = tone(453);
	for (const params of [{ amount: 0 }, { mix: 0 }]) {
		const output = await applyAutoTune([input], RATE, params);
		assert.deepEqual(output[0], input);
		assert.notEqual(output[0], input);
	}
	let seed = 9;
	const noise = Float32Array.from({ length: RATE }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed / 2 ** 32; });
	for (const input of [new Float32Array(RATE), new Float32Array(7).fill(.2), noise]) {
		assert.deepEqual(await applyAutoTune([input], RATE), [input]);
	}
	await assert.rejects(applyAutoTune([new Float32Array([NaN])], RATE), /non-finite/);
	await assert.rejects(applyAutoTune([input, input.subarray(1)], RATE), /matching lengths/);
	await assert.rejects(applyAutoTune([new Float32Array()], RATE), RangeError);
	await assert.rejects(applyAutoTune([input], 384000), RangeError);
	await assert.rejects(applyAutoTune([input], RATE, {}, { isCancelled: () => true }), { name: 'AbortError' });
});

test('real StaffPad rendering corrects pitch, keeps duration, links channels and supports partial correction', async () => {
	const staffPadRuntime = await runtime();
	const input = tone(440 * 2 ** (.4 / 12));
	const output: Float32Array[] = await applyAudioSelectionEffectAsync(TYPE, [input, input.map(value => -value * .5)], RATE,
		{ retune: 0 }, { staffPadRuntime });
	assert.equal(output.length, 2);
	assert.equal(output[0]!.length, input.length);
	assert.ok(output.every(channel => channel.every(Number.isFinite)));
	assert.ok(Math.abs(frequency(output[0]!, RATE) - 440) < 1);
	let leftEnergy = 0, rightEnergy = 0, cross = 0;
	for (let frame = RATE / 4; frame < RATE * .9; frame++) {
		leftEnergy += output[0]![frame]! ** 2;
		rightEnergy += output[1]![frame]! ** 2;
		cross += output[0]![frame]! * output[1]![frame]!;
	}
	// StaffPad's formant envelopes are nonlinear; allow their small gain difference
	// while requiring the opposite-phase image and relative channel level to survive.
	assert.ok(cross / Math.sqrt(leftEnergy * rightEnergy) < -.9999);
	assert.ok(Math.abs(Math.sqrt(rightEnergy / leftEnergy) - .5) < .02);
	const partial = await applyAutoTune([input], RATE, { retune: 0, amount: 50 }, { staffPadRuntime });
	assert.ok(Math.abs(frequency(partial[0]!, RATE) - 440 * 2 ** (.2 / 12)) < 1);
	const mixed = await applyAutoTune([input], RATE, { retune: 0, mix: 25 }, { staffPadRuntime });
	const wet = await applyAutoTune([input], RATE, { retune: 0 }, { staffPadRuntime });
	for (let frame = 0; frame < input.length; frame++) {
		assert.ok(Math.abs(mixed[0]![frame]! - (.75 * input[frame]! + .25 * wet[0]![frame]!)) < 1e-5);
	}
});

test('key/scale and retune speed change the rendered melody rather than its tempo', async () => {
	const staffPadRuntime = await runtime();
	const input = tone(280); // Slightly above C-sharp 4, outside C major.
	const major = await applyAutoTune([input], RATE, { key: 'c', scale: 'major', retune: 0 }, { staffPadRuntime });
	assert.ok(Math.abs(frequency(major[0]!, RATE) - 293.665) < 1);
	const slow = await applyAutoTune([tone(450)], RATE, { retune: 500 }, { staffPadRuntime });
	const fast = await applyAutoTune([tone(450)], RATE, { retune: 0 }, { staffPadRuntime });
	assert.ok(frequency(slow[0]!, RATE, .1, .3) > frequency(fast[0]!, RATE, .1, .3) + 3);
});

test('the contour follows successive notes with one timing and pitch decision across channel pairs', async () => {
	const staffPadRuntime = await runtime();
	const melody = new Float32Array(RATE * 2);
	melody.set(tone(450)); melody.set(tone(538), RATE);
	const output = await applyAutoTune([melody, melody, melody, new Float32Array(melody.length)], RATE,
		{ retune: 0 }, { staffPadRuntime });
	assert.equal(output.length, 4);
	for (const channel of output.slice(0, 3)) {
		assert.equal(channel.length, melody.length);
		assert.ok(Math.abs(frequency(channel, RATE, .3, .7) - 440) < 1);
		assert.ok(Math.abs(frequency(channel, RATE, 1.3, 1.7) - 523.251) < 1);
	}
	assert.ok(output[3]!.every(sample => sample === 0));
	assert.deepEqual(melody.subarray(0, RATE), tone(450), 'source PCM stays untouched');
});

test('cancellation during native rendering releases the session and permits another render', async () => {
	const staffPadRuntime = await runtime();
	let cancelled = false;
	await assert.rejects(applyAutoTune([tone(450, RATE, 2)], RATE, {}, { staffPadRuntime,
		isCancelled: () => cancelled,
		onProgress: progress => { if (progress > .3) cancelled = true; },
	}), { name: 'AbortError' });
	const output = await applyAutoTune([tone(450)], RATE, { retune: 0 }, { staffPadRuntime });
	assert.ok(Math.abs(frequency(output[0]!, RATE) - 440) < 1);
});

function frequency(samples: Float32Array, rate: number, start = .3, end = .8): number {
	const crossings: number[] = [];
	for (let frame = Math.round(rate * start) + 1; frame < rate * end; frame++) {
		const left = samples[frame - 1]!, right = samples[frame]!;
		if (left <= 0 && right > 0) crossings.push(frame - 1 - left / (right - left));
	}
	assert.ok(crossings.length > 2);
	return (crossings.length - 1) * rate / (crossings.at(-1)! - crossings[0]!);
}
