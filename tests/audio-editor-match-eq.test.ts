/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { learnMatchEqProfile } from '../src/common/editor/first-party-effects/match-eq/analysis.ts';
import { deriveMatchEqCurve } from '../src/common/editor/first-party-effects/match-eq/curve.ts';
import { MATCH_EQ_FREQUENCIES, normalizeMatchEqParams, normalizeMatchEqProfile } from '../src/common/editor/first-party-effects/match-eq/definition.ts';
import { applyMatchEq } from '../src/common/editor/first-party-effects/match-eq/selection.ts';
import { applyAudioSelectionEffectAsync, estimateAudioSelectionEffectPeakBytes } from '../src/common/editor/selection-effects.js';
import { createAudioEditorEffectPresets, exportAudioEditorEffectPreset, importAudioEditorEffectPresets, saveAudioEditorEffectPreset } from '../src/common/editor/effect-presets.js';

function noise(rate = 48000, seconds = 2): Float32Array {
	let seed = 199;
	return Float32Array.from({ length: rate * seconds }, () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
		return seed / 2 ** 33;
	});
}

test('learning ignores gain, quiet pauses, DC, and stereo polarity without mutating PCM', async () => {
	const source = noise(), copy = source.slice();
	const profile = await learnMatchEqProfile([source], 48000);
	const scaled = await learnMatchEqProfile([source.map(value => value * .1)], 48000);
	assert.ok(profile.bands.every((db, index) => Math.abs(db - scaled.bands[index]!) < 1e-5));
	const paused = new Float32Array(source.length * 2);
	paused.set(source.map(value => value * .1 + .04));
	const withPause = await learnMatchEqProfile([paused, paused.map(value => -value)], 48000);
	for (let index = 0; index < profile.bands.length; index++) {
		assert.ok(Math.abs(profile.bands[index]! - withPause.bands[index]!) < 1);
	}
	assert.deepEqual(source, copy);
	assert.equal(profile.version, 1);
	assert.equal(profile.bands.length, MATCH_EQ_FREQUENCIES.length);
	assert.ok(profile.activeSeconds > 0);
});

test('silence, insufficient audio, invalid samples, and malformed imported profiles are refused', async () => {
	await assert.rejects(learnMatchEqProfile([new Float32Array(48000)], 48000), /audible/i);
	await assert.rejects(learnMatchEqProfile([noise().slice(0, 100)], 48000), /short|quarter/i);
	const bad = noise(); bad[100] = Number.NaN;
	await assert.rejects(learnMatchEqProfile([bad], 48000));
	for (const value of [{}, { version: 2 }, { version: 1, sampleRate: 48000, activeSeconds: 1, bands: [0] },
		{ version: 1, sampleRate: 48000, activeSeconds: 1, bands: new Array<number>(128) },
		{ version: 1, sampleRate: 48000, activeSeconds: 1, bands: new Array<number>(128) },
		{ version: 1, sampleRate: 48000, activeSeconds: 1, bands: MATCH_EQ_FREQUENCIES.map(() => Number.NaN) }]) {
		assert.throws(() => normalizeMatchEqProfile(value));
	}
	assert.throws(() => normalizeMatchEqParams({ minimumFrequency: 2000, maximumFrequency: 1000 }));
});

test('analysis cancellation rejects before a partial profile can escape', async () => {
	let cancelled = false;
	await assert.rejects(learnMatchEqProfile([noise()], 48000, { isCancelled: () => cancelled,
		onProgress() { cancelled = true; } }), { name: 'AbortError' });
});

test('a normalized immutable reference keeps its identity for subsequent Match EQ control updates', () => {
	const bands = Array<number>(128).fill(-12);
	const profile = normalizeMatchEqProfile({ version: 1, sampleRate: 48_000, activeSeconds: 1, bands });
	bands[1] = -4;
	assert.equal(profile.bands[1], -12);
	assert.equal(normalizeMatchEqParams({ reference: profile, amount: 20 }).reference, profile);
	assert.ok(Object.isFrozen(profile.bands));
});

test('a profile yields a fresh, smoothed, bounded correction and never boosts missing bandwidth', async () => {
	const wide = await learnMatchEqProfile([noise()], 48000);
	const telephone = await learnMatchEqProfile([noise(8000)], 8000);
	const curve = deriveMatchEqCurve(wide, telephone, { maxGainDb: 3 });
	assert.ok(curve.every(point => Math.abs(point.gain) <= 3));
	assert.ok(curve.filter(point => point.frequency >= 4000).every(point => point.gain === 0));
	assert.ok(deriveMatchEqCurve(wide, wide).every(point => Math.abs(point.gain) < 1e-10));
	assert.ok(deriveMatchEqCurve(wide, telephone, { amount: 0 }).every(point => point.gain === 0));
});

test('matching corrects known microphone coloration, preserves geometry, and supports exact bypass', async () => {
	const source = noise(), original = source.slice();
	const colored = source.map((value, frame) => .5 * value + .25 * (source[frame - 1] ?? 0));
	const reference = await learnMatchEqProfile([source], 48000);
	const target = await learnMatchEqProfile([colored], 48000);
	const curve = deriveMatchEqCurve(reference, target);
	const low = curve.find(point => point.frequency >= 200)!;
	const high = curve.find(point => point.frequency >= 12000)!;
	assert.ok(high.gain - low.gain > 2, 'compensates the known low-pass coloration');
	const corrected = await applyAudioSelectionEffectAsync('match-eq', [colored], 48000, { reference });
	const measured = await learnMatchEqProfile(corrected, 48000);
	const residual = deriveMatchEqCurve(reference, measured);
	const error = (points: typeof curve) => points.filter(point => point.frequency > 200 && point.frequency < 10000)
		.reduce((sum, point) => sum + point.gain ** 2, 0);
	assert.ok(error(residual) < error(curve) * .15);
	assert.equal(corrected[0]!.length, source.length);
	assert.deepEqual(source, original);
	const bypass = await applyMatchEq([colored], 48000, { reference, amount: 0 });
	assert.deepEqual(bypass[0], colored);
	assert.notEqual(bypass[0], colored);
	await assert.rejects(applyMatchEq([source], 48000), /reference/i);
	assert.ok(estimateAudioSelectionEffectPeakBytes('match-eq', source.length, { reference }, { sampleRate: 48000, channelCount: 1 })
		>= source.byteLength * 4);
});

test('saved voice profiles round-trip through the existing preset library with their reference spectrum', async () => {
	const reference = await learnMatchEqProfile([noise()], 48000);
	const saved = saveAudioEditorEffectPreset(createAudioEditorEffectPresets(), { effectType: 'match-eq', name: 'Studio voice',
		params: { reference }, idFactory: () => 'voice-profile', now: '2026-11-16T12:00:00Z' });
	const encoded = exportAudioEditorEffectPreset(saved.state, saved.preset.id);
	const imported = importAudioEditorEffectPresets(createAudioEditorEffectPresets(), encoded);
	assert.deepEqual(imported.presets[0]!.params.reference, reference);
	assert.equal(imported.presets[0]!.name, 'Studio voice');
	assert.equal('curve' in imported.presets[0]!.params, false);
});
