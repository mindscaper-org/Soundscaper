/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStoredChunkProvider } from '../src/common/editor/controller/source/source-audio.ts';

test('stored read sessions retain a live stream origin without making it canonical source state', async () => {
	const calls: unknown[] = [];
	const provider = createStoredChunkProvider({ readSourceChunk: () => { throw new Error('Unexpected fallback'); },
		openSourceReadSession: async () => ({ chunk: async (_index, options) => { calls.push(options); return 'pcm'; }, release: async () => undefined }),
	}, { id: 'midi', frameCount: 4096, channelCount: 1, sampleRate: 48000, chunkFrames: 1024 },
	{ id: 'midi', frameCount: 4096, channelCount: 1, sampleRate: 48000, chunkFrames: 1024, chunkCount: 4 });
	try {
		await provider.readStorageChunk(2, { renderStartFrame: 2048, streamId: 'live' });
		await provider.readStorageChunk(2);
		assert.deepEqual(calls, [{ renderStartFrame: 2048 }, {}]);
	} finally { await provider.dispose(); }
});
