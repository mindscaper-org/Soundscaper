/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeDialogueAlignment, dialogueSourceAtOutput } from '../src/common/editor/dialogue-alignment.ts';
import { dialogueFixture } from './helpers/dialogue-alignment-fixture.ts';

test('dialogue alignment follows internal voiced units rather than just total duration', () => {
	const reference = dialogueFixture([.45, .6, .35, .5]);
	const replacement = dialogueFixture([.6, .4, .55, .35], 8000, .4);
	const result = analyzeDialogueAlignment({ reference: [reference], replacement: [replacement], sampleRate: 8000, strength: 1 });
	assert.equal(result.outputFrames, reference.length);
	for (const [outer, source] of [[.45, .6], [1.05, 1], [1.4, 1.55]]) {
		assert.ok(Math.abs(dialogueSourceAtOutput(result, outer! * 8000) / 8000 - source!) < .065);
	}
	assert.deepEqual(result.points[0], { outputFrame: 0, sourceFrame: 0 });
	assert.deepEqual(result.points.at(-1), { outputFrame: reference.length, sourceFrame: replacement.length });
	for (let index = 1; index < result.points.length; index++) {
		const left = result.points[index - 1]!, right = result.points[index]!;
		const rate = (right.sourceFrame - left.sourceFrame) / (right.outputFrame - left.outputFrame);
		assert.ok(rate >= .5 - 1e-6 && rate <= 2 + 1e-6, `bounded stretch ${rate}`);
	}
});

test('opposite stereo polarities do not cancel analysis; reduced strength approaches uniform timing', () => {
	const reference = dialogueFixture([.45, .6, .35, .5]);
	const replacement = dialogueFixture([.6, .4, .55, .35]);
	const result = analyzeDialogueAlignment({ reference: [reference, reference.map(value => -value)],
		replacement: [replacement, replacement.map(value => -value)], sampleRate: 8000, strength: 0 });
	assert.ok(Math.abs(dialogueSourceAtOutput(result, 6000) - 6000) < 1);
});

test('unequal durations and incomplete final analysis frames retain bounded rates and exact endpoints', () => {
	const reference = dialogueFixture([.453, .607, .351, .5]);
	const replacement = dialogueFixture([.611, .407, .552, .38]);
	const result = analyzeDialogueAlignment({ reference: [reference], replacement: [replacement], sampleRate: 8000, strength: 1 });
	assert.equal(result.outputFrames, reference.length);
	assert.equal(result.points.at(-1)!.sourceFrame, replacement.length);
	for (let index = 1; index < result.points.length; index++) {
		const left = result.points[index - 1]!, right = result.points[index]!;
		const ratio = (right.sourceFrame - left.sourceFrame) / (right.outputFrame - left.outputFrame);
		assert.ok(ratio >= .5 - 1e-6 && ratio <= 2 + 1e-6);
	}
});

test('silent, excessive, invalid and unsupported selections fail before allocating alignment work', () => {
	const voice = dialogueFixture([.5, .5]);
	const request = { reference: [voice], replacement: [voice], sampleRate: 8000, strength: 1 };
	assert.throws(() => analyzeDialogueAlignment({ ...request, reference: [new Float32Array(8000)] }), /silent/i);
	assert.throws(() => analyzeDialogueAlignment({ ...request, reference: [new Float32Array(8000).fill(.3)] }), /silent/i);
	assert.throws(() => analyzeDialogueAlignment({ ...request, strength: NaN }), /strength/i);
	assert.throws(() => analyzeDialogueAlignment({ ...request, replacement: [new Float32Array(8000 * 31)] }), /30 seconds/i);
	assert.throws(() => analyzeDialogueAlignment({ ...request, reference: [voice, voice, voice] }), /mono or stereo/i);
	assert.throws(() => analyzeDialogueAlignment({ ...request, replacement: [voice.map(() => NaN)] }), /finite/i);
});

test('unrelated noise and reversed speech units do not produce an accepted acoustic match', () => {
	const reference = dialogueFixture([.45, .6, .35, .5]);
	let seed = 42;
	const noise = Float32Array.from({ length: reference.length }, () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return seed / 2 ** 33; });
	for (const replacement of [noise, reference.slice().reverse()]) {
		assert.throws(() => analyzeDialogueAlignment({ reference: [reference], replacement: [replacement], sampleRate: 8000, strength: 1 }), /not sufficiently similar/i);
	}
});

test('long silent handles cannot turn unrelated dialogue into an accepted match', () => {
	const spoken = dialogueFixture([.45, .6, .35, .5]);
	const reference = new Float32Array(20 * 8000);
	reference.set(spoken, 8 * 8000);
	const replacement = new Float32Array(reference.length);
	replacement.set(spoken.slice().reverse(), 8 * 8000);
	assert.throws(() => analyzeDialogueAlignment({ reference: [reference], replacement: [replacement], sampleRate: 8000, strength: 1 }), /not sufficiently similar/iu);
	const result = analyzeDialogueAlignment({ reference: [reference], replacement: [reference.slice()], sampleRate: 8000, strength: 1 });
	assert.ok(result.mismatch < .01);
});
