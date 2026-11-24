/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TRACKTION_BLOCK_FRAMES, TracktionAudioQueue } from '../../../src/soundscaper/tracktion-audio-queue.ts';

test('the Tracktion audio queue preserves stereo order through cursor wrap and underrun', () => {
	const writer = new TracktionAudioQueue();
	const reader = new TracktionAudioQueue(writer.shared);
	const cursor = new Int32Array(writer.shared, 0, 2);
	// Cross both the signed cursor boundary and the ring's last frame.
	Atomics.store(cursor, 0, 0x7fffffc0);
	Atomics.store(cursor, 1, 0x7fffffc0);
	const planar = new Float32Array(TRACKTION_BLOCK_FRAMES * 2);
	for (let frame = 0; frame < TRACKTION_BLOCK_FRAMES; frame += 1) {
		planar[frame] = frame / TRACKTION_BLOCK_FRAMES;
		planar[frame + TRACKTION_BLOCK_FRAMES] = -0.25;
	}
	assert.equal(writer.writableBlocks(), 16);
	writer.writeBlock(planar);
	const left = new Float32Array(192);
	const right = new Float32Array(192);
	left.fill(1);
	right.fill(1);
	reader.read(left, right);
	assert.deepEqual(left.subarray(0, TRACKTION_BLOCK_FRAMES), planar.subarray(0, TRACKTION_BLOCK_FRAMES));
	assert.deepEqual(right.subarray(0, TRACKTION_BLOCK_FRAMES), planar.subarray(TRACKTION_BLOCK_FRAMES));
	assert.ok(left.subarray(TRACKTION_BLOCK_FRAMES).every((sample) => sample === 0));
	assert.ok(right.subarray(TRACKTION_BLOCK_FRAMES).every((sample) => sample === 0));
	assert.equal(Atomics.load(cursor, 0), Atomics.load(cursor, 1));
});

test('a full Tracktion audio queue waits for the consumer before writing again', () => {
	const writer = new TracktionAudioQueue();
	const reader = new TracktionAudioQueue(writer.shared);
	const silence = new Float32Array(TRACKTION_BLOCK_FRAMES * 2);
	for (let block = 0; block < 16; block += 1) {
		assert.equal(writer.writableBlocks(), 16 - block);
		writer.writeBlock(silence);
	}
	assert.equal(writer.writableBlocks(), 0);
	reader.read(new Float32Array(TRACKTION_BLOCK_FRAMES - 1), new Float32Array(TRACKTION_BLOCK_FRAMES - 1));
	assert.equal(writer.writableBlocks(), 0);
	reader.read(new Float32Array(1), new Float32Array(1));
	assert.equal(writer.writableBlocks(), 1);
});
