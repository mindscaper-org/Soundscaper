/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistanceBeatThisGridV1 } from '../src/common/editor/assistance/beat-this-postprocess-v1.ts';
import { sceneScoresToBoundaries } from '../src/common/editor/assistance/scene-scores.ts';

test('A05 downbeat snapping searches ordered beats logarithmically', () => {
	const frames = 8000;
	const beats = new Float32Array(frames).fill(-1);
	const downbeats = new Float32Array(frames).fill(-1);
	for (let frame = 0; frame < frames; frame += 8) { beats[frame] = 2; downbeats[frame + 2] = 2; }
	const original = Math.abs;
	let comparisons = 0;
	Math.abs = value => { comparisons++; return original(value); };
	try {
		const result = createAssistanceBeatThisGridV1({ schemaVersion: 1, sampleRate: 22050, framesPerSecond: 50, beatLogits: beats, downbeatLogits: downbeats });
		assert.equal(result.points.length, 1000);
		assert.ok(result.points.every(point => point.kind === 'downbeat'));
		assert.ok(comparisons < 20000, `distance comparisons: ${comparisons}`);
	} finally { Math.abs = original; }
});

test('A06 scene median sorts its invocation-owned neighborhood without cloning it', () => {
	const scores = Array.from({ length: 100 }, (_, frame) => ({ frame, score: frame % 10 === 0 ? .9 : .2 }));
	const original = Array.prototype[Symbol.iterator];
	let iterations = 0;
	Array.prototype[Symbol.iterator] = function <T>(this: T[]): ArrayIterator<T> { iterations++; return original.call(this) as ArrayIterator<T>; };
	try {
		const result = sceneScoresToBoundaries(scores);
		assert.deepEqual(result.map(entry => entry.frame), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
		assert.ok(iterations < 120, `array iterator constructions: ${iterations}`);
	} finally { Array.prototype[Symbol.iterator] = original; }
	assert.equal(scores[0]?.score, .9);
});

test('A07 Beat This pooling stops after finding a stronger neighbor', () => {
	const beats = Float32Array.from({ length: 8000 }, (_, frame) => frame % 8 + 1);
	const original = Math.max;
	let comparisons = 0;
	Math.max = (...values) => { comparisons++; return original(...values); };
	try {
		const result = createAssistanceBeatThisGridV1({ schemaVersion: 1, sampleRate: 22050, framesPerSecond: 50, beatLogits: beats, downbeatLogits: beats });
		assert.equal(result.points.length, 1000);
		assert.equal(result.points[0]?.sample, Math.round(7 * 22050 / 50));
		assert.ok(comparisons < 30000, `pooling maximum calculations: ${comparisons}`);
	} finally { Math.max = original; }
});
