/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TRACKTION_BLOCK_FRAMES, TracktionAudioQueue } from '../../../src/soundscaper/tracktion-audio-queue.ts';
import { TracktionCaptureQueue } from '../../../src/soundscaper/tracktion-capture-queue.ts';

import { TracktionHostedAudio } from '../wasm/tracktion-hosted-audio.ts';

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

test('the Tracktion microphone queue preserves its prefix and partial last block across wrap', () => {
	const producer = new TracktionCaptureQueue();
	const consumer = new TracktionCaptureQueue(producer.shared);
	const cursor = new Int32Array(producer.shared, 0, 3);
	Atomics.store(cursor, 0, 0x7fffffc0);
	Atomics.store(cursor, 1, 0x7fffffc0);
	const prefix = Float32Array.from({ length: 65_500 }, (_, frame) => (frame % 128) / 128);
	assert.ok(producer.write(prefix));
	assert.equal(consumer.readableFrames(), prefix.length);
	const copy = new Float32Array(prefix.length);
	consumer.peek(copy, prefix.length);
	assert.deepEqual(copy, prefix);
	assert.equal(consumer.readableFrames(), prefix.length, 'the backend can retry a block before consuming it');
	consumer.consume(64);
	assert.equal(producer.write(new Float32Array(TRACKTION_BLOCK_FRAMES).fill(-0.25)), false);
	assert.ok(consumer.sealed);
	assert.equal(consumer.readableFrames(), 65_536);
	const captured = new Float32Array(65_536);
	consumer.peek(captured, captured.length);
	assert.deepEqual(captured.subarray(0, prefix.length - 64), prefix.subarray(64));
	assert.ok(captured.subarray(prefix.length - 64).every((sample) => sample === -0.25));
	consumer.consume(captured.length);
	producer.write(new Float32Array(32));
	assert.equal(consumer.readableFrames(), 0);
});

test('a Tracktion microphone stop leaves its last queued frames available to record', () => {
	const queue = new TracktionCaptureQueue();
	const input = new Float32Array(37).fill(0.375);
	queue.write(input);
	queue.seal();
	queue.write(new Float32Array(128));
	const output = new Float32Array(input.length);
	queue.peek(output, output.length);
	assert.deepEqual(output, input);
	assert.equal(queue.readableFrames(), input.length);
	assert.ok(queue.sealed);
});

test('the Tracktion worker drains the whole take when output is full and the backend retries', async () => {
	const output = new TracktionAudioQueue();
	const capture = new TracktionCaptureQueue();
	const memory = new Uint8Array(4096);
	const heard: number[] = [];
	const frames: number[] = [];
	let available = false;
	let freed = false;
	const audio = new TracktionHostedAudio({
		HEAPU8: memory,
		_malloc: () => 8,
		_free: (pointer) => { freed = pointer === 8; },
		_soundscaper_read_playback: (_output, input, count) => {
			if (!available) {
				available = true;
				return 0;
			}
			heard.push(...new Float32Array(memory.buffer, input, count));
			frames.push(count);
			return 1;
		},
	}, { output: output.shared, capture: capture.shared });
	const samples = Float32Array.from({ length: 18 * TRACKTION_BLOCK_FRAMES + 37 }, (_, frame) => (frame % 251) / 256);
	capture.write(samples);
	await audio.drain();
	audio.stop();
	assert.ok(freed);
	assert.equal(capture.readableFrames(), 0);
	assert.equal(output.writableBlocks(), 0);
	assert.equal(frames.length, 19);
	assert.equal(frames.at(-1), 37);
	assert.deepEqual(heard, Array.from(samples));
});
