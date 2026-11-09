/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findRepeatedSoundMatches } from '../src/common/editor/repeated-sound-correlation.ts';
import { selectRepeatedSoundMatches } from '../src/common/editor/repeated-sound.ts';

function noise(length: number, seed = 7): Float32Array {
	return Float32Array.from({ length }, () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return (seed / 2 ** 32 - .5) * .6;
	});
}

test('repeated sound finds sample-exact, gain-changed copies including the final possible offset', async () => {
	const example = noise(128), recording = noise(1200, 17);
	for (const [offset, gain] of [[0, 1], [419, .3], [1072, .7]]) {
		recording.set(example.map(value => value * gain + .05), offset);
	}
	const matches = await findRepeatedSoundMatches([example], [recording], .99);
	assert.deepEqual(matches.map(match => match.startFrame), [0, 419, 1072]);
	assert.ok(matches.every(match => match.similarity > .999));
});

test('similarity threshold admits a noisy duplicate only when relaxed', async () => {
	const example = noise(128), recording = noise(800, 11), interference = noise(128, 31);
	recording.set(example, 40);
	recording.set(example.map((value, index) => value + .5 * interference[index]!), 500);
	assert.deepEqual((await findRepeatedSoundMatches([example], [recording], .99)).map(match => match.startFrame), [40]);
	assert.deepEqual((await findRepeatedSoundMatches([example], [recording], .8)).map(match => match.startFrame), [40, 500]);
});

test('multichannel comparison preserves opposite-phase stereo and ignores silent channels', async () => {
	const example = noise(128), recording = new Float32Array(800);
	recording.set(example, 230);
	const matches = await findRepeatedSoundMatches(
		[new Float32Array(128), example, example.map(value => -value)],
		[new Float32Array(800), recording, recording.map(value => -value)], .99,
	);
	assert.deepEqual(matches.map(match => match.startFrame), [230]);
});

test('silence, invalid thresholds, non-finite PCM and mismatched channel geometry are refused', async () => {
	await assert.rejects(findRepeatedSoundMatches([new Float32Array(32)], [noise(64)], .9), /silent/i);
	await assert.rejects(findRepeatedSoundMatches([noise(32)], [noise(64)], NaN), /threshold/i);
	await assert.rejects(findRepeatedSoundMatches([noise(32)], [noise(64)], 0), /threshold/i);
	await assert.rejects(findRepeatedSoundMatches([noise(32)], [noise(64), noise(64)], .9), /channel/i);
	await assert.rejects(findRepeatedSoundMatches([noise(32)], [new Float32Array([NaN, ...noise(63)])], .9), /finite/i);
});

test('overlapping candidates consolidate across chunks while the exact original is always retained', () => {
	const original = { startFrame: 100, endFrame: 200, similarity: 1, original: true };
	assert.deepEqual(selectRepeatedSoundMatches([
		{ startFrame: 99, endFrame: 199, similarity: 1 },
		{ startFrame: 400, endFrame: 500, similarity: .91 },
		{ startFrame: 401, endFrame: 501, similarity: .98 },
		{ startFrame: 501, endFrame: 601, similarity: .95 },
	], original), [original,
		{ startFrame: 401, endFrame: 501, similarity: .98, original: false },
		{ startFrame: 501, endFrame: 601, similarity: .95, original: false },
	]);
});
