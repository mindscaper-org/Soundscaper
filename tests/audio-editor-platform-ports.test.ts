/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PLATFORM_TRANSFER_HARD_LIMITS,
	createBoundedAudioChunk,
	createBoundedByteChunk,
	createBoundedPortMessage,
} from '../src/common/editor/platform/bounded-transfer.ts';

test('bounded transfer factories reject oversized or malformed chunks and messages', () => {
	const bytes = createBoundedByteChunk(new Uint8Array([1, 2, 3]), {
		sequence: 4,
		maximumByteLength: 4,
		final: true,
	});
	assert.deepEqual({
		sequence: bytes.sequence,
		byteLength: bytes.byteLength,
		maximumByteLength: bytes.maximumByteLength,
		final: bytes.final,
	}, { sequence: 4, byteLength: 3, maximumByteLength: 4, final: true });
	assert.equal(Object.isFrozen(bytes), true);
	assert.throws(() => createBoundedByteChunk(new Uint8Array(5), {
		sequence: 0,
		maximumByteLength: 4,
	}), /maximumByteLength/u);
	assert.throws(() => createBoundedByteChunk(new Uint8Array(1), {
		sequence: 0,
		maximumByteLength: PLATFORM_TRANSFER_HARD_LIMITS.mediaChunkBytes + 1,
	}), /hard limit/u);

	const audio = createBoundedAudioChunk([
		new Float32Array([0.25, -0.25]),
		new Float32Array([0.5, -0.5]),
	], {
		sequence: 2,
		maximumFrameCount: 4,
		startFrame: 8,
	});
	assert.deepEqual({
		sequence: audio.sequence,
		channelCount: audio.channelCount,
		frameCount: audio.frameCount,
		byteLength: audio.byteLength,
		startFrame: audio.startFrame,
	}, { sequence: 2, channelCount: 2, frameCount: 2, byteLength: 16, startFrame: 8 });
	assert.equal(Object.isFrozen(audio.channels), true);
	assert.throws(() => createBoundedAudioChunk([
		new Float32Array(2),
		new Float32Array(1),
	], { sequence: 0, maximumFrameCount: 2 }), /same frame count/u);

	const progress = { completed: 3, total: 10 };
	const message = createBoundedPortMessage('progress', progress, {
		sequence: 1,
		maximumEncodedBytes: 256,
	});
	progress.completed = 9;
	assert.equal(message.type, 'progress');
	assert.equal(message.payload.completed, 3);
	assert.equal(Object.isFrozen(message.payload), true);
	assert.equal(message.encodedByteLength <= message.maximumEncodedBytes, true);
	assert.throws(() => createBoundedPortMessage('progress', { detail: 'x'.repeat(256) }, {
		sequence: 0,
		maximumEncodedBytes: 32,
	}), /maximumEncodedBytes/u);
	assert.throws(() => createBoundedPortMessage('progress', { completed: Number.POSITIVE_INFINITY }, {
		sequence: 0,
		maximumEncodedBytes: 256,
	}), /JSON-compatible/u);
});
