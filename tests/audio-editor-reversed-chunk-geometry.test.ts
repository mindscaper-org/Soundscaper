/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createReversedChunkSource, readChunkSourceRange } from '../src/common/editor/engine/clip-scheduler-chunk-sources.ts';
import { createOfflineChunkResampleBuffer } from '../src/common/editor/engine/offline-chunk-resample.ts';
import type { EngineChunkSource } from '../src/common/editor/engine/types.ts';
import { MockOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

for (const shortChannel of [0, 1]) test(`reversed offline resampling rejects a short channel ${String(shortChannel)} before manufacturing PCM`, async () => {
	const source: EngineChunkSource = {
		channelCount: 2, frameCount: 8, sampleRate: 48_000, chunkFrames: 4,
		readStorageChunk: () => [0, 1].map(channel => new Float32Array(channel === shortChannel ? 2 : 4).fill(channel + 1)),
	};
	const context = new MockOfflineAudioContext({ numberOfChannels: 2, length: 4, sampleRate: 24_000 });
	await assert.rejects(createOfflineChunkResampleBuffer({ context: context as unknown as BaseAudioContext,
		source: createReversedChunkSource(source), inputOffsetFrame: 0, inputFrameCount: 8, outputFrameCount: 4,
	}), /channel geometry/iu);
});

test('a partial read rejects secondary-channel truncation instead of returning zero-filled audio', async () => {
	await assert.rejects(readChunkSourceRange({ channelCount: 2, frameCount: 8, sampleRate: 48_000, chunkFrames: 8,
		readStorageChunk: () => [new Float32Array(8).fill(1), new Float32Array(4).fill(2)],
	}, 3, 7), /channel geometry/iu);
});

test('reversed ranges retain every channel across storage boundaries and a short final chunk', async () => {
	const channels = [Float32Array.from({ length: 11 }, (_, frame) => frame), Float32Array.from({ length: 11 }, (_, frame) => frame + 100)];
	const source: EngineChunkSource = { channelCount: 2, frameCount: 11, sampleRate: 48_000, chunkFrames: 4,
		readStorageChunk: index => ({ channels: channels.map(channel => channel.subarray(index * 4, (index + 1) * 4)) }),
	};
	const reversed = createReversedChunkSource(source);
	assert.deepEqual(await readChunkSourceRange(reversed, 2, 10), channels.map(channel => channel.slice().reverse().slice(2, 10)));
	assert.deepEqual(channels[0], Float32Array.from({ length: 11 }, (_, frame) => frame));
});
