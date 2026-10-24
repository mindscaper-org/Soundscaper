/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { requestCachedWaveformPeakWindow } from '../src/common/editor/controller/source/internal/waveform-peak-window-cache.ts';
import { readWaveformPeakWindow } from '../src/common/editor/controller/source/internal/waveform-peak-window-reader.ts';

test('neighbouring zoom and scroll steps share source-aligned peak analysis', async () => {
	const reads: number[] = [];
	const provider = { channelCount: 1, chunkFrames: 65_536,
		readStorageChunk(index: number) {
			reads.push(index);
			return { channels: [new Float32Array(65_536).fill(0.25)] };
		} };
	const common = { cacheKey: 'clip', sourceId: 'source', sourceFrameCount: 1_048_576,
		maximumEntries: 2, requests: new Map(), windows: new Map(), getProvider: async () => provider,
		readWindow: readWaveformPeakWindow, isCurrent: () => true, isRetiredError: () => false, publish() {} };
	const first = await requestCachedWaveformPeakWindow({ ...common,
		range: { startFrame: 100_000, endFrame: 200_000 }, pixelWidth: 1_000, maximumBlockSize: 100 });
	assert.ok(first);
	const coldReads = reads.length;
	for (let step = 0; step < 20; step++) {
		const result = await requestCachedWaveformPeakWindow({ ...common,
			range: { startFrame: 100_000 + step * 100, endFrame: 200_000 + step * 100 },
			pixelWidth: 1_000 + step, maximumBlockSize: 98 - step });
		assert.strictEqual(result, first);
	}
	assert.equal(reads.length, coldReads);
	assert.equal(first.blockSize, 64);
	assert.equal(first.startFrame % (64 * 256), 0);
	assert.equal(first.channels[0]?.minimums[0], 0.25);
});

test('overscan respects source ends, exact sample scales and the viewport bucket budget', async () => {
	for (const [startFrame, endFrame, pixelWidth, maximumBlockSize] of [
		[0, 100_000, 1_000, 100], [948_576, 1_048_576, 1_000, 100],
		[0, 65_536, 65_536, 1], [0, 1_048_576, 65_536, 16],
	] as const) {
		const provider = { channelCount: 1, chunkFrames: 65_536,
			readStorageChunk: () => ({ channels: [new Float32Array(65_536)] }) };
		const result = await requestCachedWaveformPeakWindow({
			cacheKey: 'clip', sourceId: 'source', sourceFrameCount: 1_048_576,
			range: { startFrame, endFrame }, pixelWidth, maximumBlockSize, maximumEntries: 2,
			requests: new Map(), windows: new Map(), getProvider: async () => provider,
			readWindow: readWaveformPeakWindow, isCurrent: () => true, isRetiredError: () => false, publish() {},
		});
		assert.ok(result);
		assert.ok(result.startFrame >= 0 && result.startFrame <= startFrame);
		assert.ok(result.endFrame <= 1_048_576 && result.endFrame >= endFrame);
		assert.ok(result.blockSize <= maximumBlockSize);
		assert.ok(result.channels[0]!.minimums.length <= 65_536);
	}
});
