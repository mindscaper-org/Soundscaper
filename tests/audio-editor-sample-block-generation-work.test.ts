/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { planAudacitySampleBlockStorage } from '../src/common/editor/aup4-import-block-storage.ts';
import type { Aup4ImportSourcePlan } from '../src/common/editor/aup4-import-plan.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createStoredChunkProvider } from '../src/common/editor/controller/source/source-audio.ts';

const BLOCKS = 512, BLOCK_FRAMES = 16_385, CHUNK_FRAMES = 65_536;

test('actual stored playback keeps one immutable admitted block layout and fresh scalar chunk fences', async context => {
	const frames = BLOCKS * BLOCK_FRAMES;
	const source: Aup4ImportSourcePlan = { sourceId: 'audio', sampleRate: 48_000, channelCount: 1, frameCount: frames,
		channelPlans: [{ sampleRate: 48_000, frameCount: frames, outputFrames: frames,
			blocks: Array.from({ length: BLOCKS }, (_, index) => ({ blockId: -BLOCK_FRAMES, start: index * BLOCK_FRAMES, frameCount: BLOCK_FRAMES })) }] };
	const plan = planAudacitySampleBlockStorage([source], 'pool');
	assert.equal(plan.sequences[0]!.channels[0]!.length, BLOCKS);
	const project = createSoundscaperProject({ id: 'stored-block-generation',
		sources: [{ id: 'audio', storageKey: 'audio', frameCount: frames, channelCount: 1, sampleRate: 48_000 }],
		tracks: [{ id: 'track', clipIds: ['clip'] }], clips: [{ id: 'clip', sourceId: 'audio', sourceStartFrame: 0,
			sourceDurationFrames: frames, durationFrames: frames, timelineStartFrame: 0 }] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `block-generation-${crypto.randomUUID()}` });
	context.after(async () => { await store.close(); });
	const writer = await store.beginSourceWrite('pool', { sampleRate: 48_000, channelCount: 1, chunkFrames: CHUNK_FRAMES });
	await writer.write([Float32Array.of(0)]);
	await writer.commit();
	const sequence = plan.sequences[0]!;
	await store.writeSampleBlockSource('audio', sequence.baseSourceId, sequence.channels,
		{ sampleRate: 48_000, channelCount: 1, frameCount: frames, chunkFrames: CHUNK_FRAMES });
	const metadata = await store.getSourceMetadata('audio');
	assert.ok(metadata);
	assert.ok(frames * 4 > 32 * 1024 * 1024, 'the real source activation streaming threshold is exceeded');
	const clone = globalThis.structuredClone;
	let copies = 0, blockReferences = 0;
	globalThis.structuredClone = function<T>(value: T, options?: StructuredSerializeOptions): T {
		if (value && typeof value === 'object' && 'storage' in value && value.storage === 'sample-block-sequence'
			&& 'sampleBlockChannels' in value && Array.isArray(value.sampleBlockChannels)) {
			copies++; blockReferences += (value.sampleBlockChannels as unknown[][]).reduce((sum, channel) => sum + channel.length, 0);
		}
		return clone(value, options);
	};
	const audio = project.sources[0]!;
	assert.ok(audio.kind === 'audio');
	const provider = createStoredChunkProvider(store, audio, metadata);
	let readFrames = 0;
	try {
		for (let index = 0; index < Number(metadata.chunkCount); index++) {
			const chunk = await provider.readStorageChunk(index);
			assert.ok(chunk && typeof chunk === 'object' && 'frames' in chunk && typeof chunk.frames === 'number' && 'channels' in chunk && Array.isArray(chunk.channels));
			readFrames += chunk.frames;
			const channels = chunk.channels as readonly unknown[];
			assert.equal(channels.length, 1);
			const channel = channels[0];
			assert.ok(channel instanceof Float32Array);
			assert.ok(channel.every(value => Object.is(value, 0)));
		}
		assert.equal(readFrames, frames);
		assert.equal(copies, 1, `${copies} complete immutable block-layout copies`);
		assert.equal(blockReferences, BLOCKS);
	} finally { await provider.dispose(); globalThis.structuredClone = clone; }
});
