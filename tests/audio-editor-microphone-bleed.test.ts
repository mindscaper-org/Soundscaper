/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMicrophoneBleedBlock, buildMicrophoneBleedCurves, normalizeMicrophoneBleedOptions } from '../src/common/editor/microphone-bleed.ts';
import { composeMicrophoneBleedEnvelope } from '../src/common/editor/microphone-bleed-envelope.ts';
import { createEnvelopeValueEvaluator } from '../src/common/editor/automation.js';

const rate = 8000;
function voice(seed: number, seconds = 2): Float32Array {
	let state = seed, smooth = 0;
	return Float32Array.from({ length: rate * seconds }, () => {
		state = Math.imul(state, 1664525) + 1013904223 | 0;
		smooth = .85 * smooth + .15 * state / 2 ** 31;
		return smooth;
	});
}

test('joint analysis ducks delayed, polarity-inverted bleed and preserves independent simultaneous speech', () => {
	const a = voice(23), b = voice(701);
	const spill = Float32Array.from(a, (_, i) => -.2 * (a[i - 32] ?? 0));
	const overlap = Float32Array.from(spill, (sample, i) => sample + b[i]! * .15);
	const request = { sampleRate: rate, offsetFrames: 0, frameCount: a.length, options: {} };
	const bleed = analyzeMicrophoneBleedBlock({ ...request, tracks: [[a], [spill, Float32Array.from(spill, x => -x)]] });
	assert.ok(bleed[0]!.every(value => !value), 'the primary mic stays open');
	assert.ok(bleed[1]!.slice(5, -5).every(Boolean), 'delayed copies are recognized without summing opposite stereo channels');
	const talking = analyzeMicrophoneBleedBlock({ ...request, tracks: [[a], [overlap]] });
	assert.ok(talking[1]!.filter(Boolean).length < talking[1]!.length * .05, 'a quieter independent speaker is protected');
});

test('silence, constant signals, equally loud microphones and unrelated sounds do not trigger ducking', () => {
	const a = voice(23), b = voice(701), silence = new Float32Array(a.length), dc = new Float32Array(a.length).fill(.1);
	for (const tracks of [[[silence], [silence]], [[dc], [dc]], [[a], [a]], [[a], [b]]]) {
		assert.ok(analyzeMicrophoneBleedBlock({ tracks, sampleRate: rate, offsetFrames: 0, frameCount: a.length, options: {} }).flat().every(value => !value));
	}
});

test('sparse curves hold speech open, anticipate interruptions, and join chunks without a seam', () => {
	const decisions = Array.from({ length: 100 }, (_, i) => i < 50 || i >= 60);
	const curves = buildMicrophoneBleedCurves([decisions], rate, 16000, {});
	const value = createEnvelopeValueEvaluator(curves[0], 16000);
	assert.equal(value(0), 1);
	assert.ok(Math.abs(value(4000) - 10 ** (-12 / 20)) < 1e-6);
	assert.equal(value(8000 - 160), 1, 'opens before independent speech begins');
	assert.equal(value(8800), 1, 'the interruption stays intact');
	assert.equal(value(16000), 1, 'selection boundaries return to the original gain');
	assert.ok(curves[0]!.length <= 10);
	assert.deepEqual(buildMicrophoneBleedCurves([[false, true, false]], rate, 480, {}), [[{ frame: 0, value: 1 }, { frame: 480, value: 1 }]], 'short detections cannot chatter');
});

test('envelope composition preserves existing edits outside the selection and approximates the product inside it', () => {
	const existing = [{ frame: 0, value: .3 }, { frame: 200, value: .8 }, { frame: 1000, value: .2 }];
	const duck = [{ frame: 0, value: 1 }, { frame: 100, value: .25 }, { frame: 400, value: .25 }, { frame: 500, value: 1 }];
	const merged = composeMicrophoneBleedEnvelope(existing, 1000, duck, 300);
	const before = createEnvelopeValueEvaluator(existing, 1000), after = createEnvelopeValueEvaluator(merged, 1000);
	const reduction = createEnvelopeValueEvaluator(duck, 500);
	for (let frame = 0; frame <= 1000; frame++) {
		const expected = before(frame) * (frame >= 300 && frame <= 800 ? reduction(frame - 300) : 1);
		assert.ok(Math.abs(after(frame) - expected) < .0001, `gain at frame ${frame}`);
	}
	assert.deepEqual(existing, [{ frame: 0, value: .3 }, { frame: 200, value: .8 }, { frame: 1000, value: .2 }]);
});

test('invalid settings and oversized input are refused', () => {
	assert.throws(() => normalizeMicrophoneBleedOptions({ maximumReductionDb: NaN }));
	assert.throws(() => normalizeMicrophoneBleedOptions({ minimumSimilarity: 1.1 }));
	assert.throws(() => analyzeMicrophoneBleedBlock({ tracks: [[new Float32Array(1)]], sampleRate: rate, offsetFrames: 0, frameCount: 1, options: {} }));
});

test('partial selections and clips that start mid-selection retain their existing gain outside the duck', () => {
	const curve = [{ frame: 0, value: 1 }, { frame: 100, value: .25 }, { frame: 900, value: .25 }, { frame: 1000, value: 1 }];
	const a = composeMicrophoneBleedEnvelope([], 500, curve, -200);
	const gain = createEnvelopeValueEvaluator(a, 500);
	assert.equal(gain(0), .25); assert.equal(gain(499), .25);
	const silent = [{ frame: 0, value: 0 }, { frame: 500, value: 0 }];
	assert.ok(composeMicrophoneBleedEnvelope(silent, 500, curve, -200).every(point => point.value === 0));
	assert.deepEqual(composeMicrophoneBleedEnvelope(silent, 500, [{ frame: 0, value: 1 }, { frame: 1000, value: 1 }], 0), silent);
});

test('48 kHz speech-shaped copies survive a non-grid delay and modest microphone coloration', () => {
	let seed = 311, smooth = 0;
	const a = Float32Array.from({ length: 96000 }, () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; smooth = .98 * smooth + .02 * seed / 2 ** 31; return smooth; });
	const b = Float32Array.from(a, (_, i) => .1 * ((a[i - 157] ?? 0) + (a[i - 159] ?? 0)));
	const result = analyzeMicrophoneBleedBlock({ tracks: [[a], [b]], sampleRate: 48000, offsetFrames: 0, frameCount: a.length, options: {} });
	assert.ok(result[1]!.slice(5, -5).filter(Boolean).length > result[1]!.slice(5, -5).length * .9);
});
