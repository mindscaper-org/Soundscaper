/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createPencilSampleEdits, persistImmutableSampleEdit } from '../src/common/editor/sample-edit.js';
import { SOURCE_CHUNK_FRAMES } from '../src/common/editor/source-pcm-contract.ts';

test('late Pencil and Smooth read only changed chunks and their smoothing context', async () => {
	const chunks = 8;
	const frameCount = (chunks - 1) * SOURCE_CHUNK_FRAMES + 40;
	const project = projectForRuntimeConsumers(createSoundscaperProject({ sources: [{ id: 'source', storageKey: 'source', name: 'Recording', sampleRate: 48_000, channelCount: 1, frameCount, chunkFrames: SOURCE_CHUNK_FRAMES }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: frameCount - 32, sourceDurationFrames: 32, durationFrames: 32 }], tracks: [{ id: 'track', clipIds: ['clip'] }] }));
	const source = project.sources[0]!;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'bounded-sample-edit' });
	try {
		const writer = await store.beginSourceWrite(source.id, source);
		for (let index = 0; index < chunks; index += 1) await writer.write([new Float32Array(Math.min(SOURCE_CHUNK_FRAMES, frameCount - index * SOURCE_CHUNK_FRAMES)).fill(0.25)]);
		await writer.commit();
		const originalChunks = store.readSourceChunks.bind(store);
		const originalSession = store.openSourceReadSession.bind(store);
		let reads = 0; let releases = 0;
		store.readSourceChunks = async function* (...args: Parameters<typeof originalChunks>) {
			for await (const chunk of originalChunks(...args)) { reads += 1; yield chunk; }
		};
		store.openSourceReadSession = async (...args: Parameters<typeof originalSession>) => {
			const session = await originalSession(...args);
			if (!session) return null;
			return { async chunk(index, options) { reads += 1; return session.chunk(index, options); }, async release() { releases += 1; await session.release(); } };
		};
		const edits = createPencilSampleEdits({ clip: project.clips[0]!, source, project, points: [{ timelineFrame: 1, value: 0.5 }] });
		const pencil = await persistImmutableSampleEdit({ store, source, edits, sourceId: 'pencil' });
		assert.equal(reads, 1); assert.equal(releases, 1);
		assert.deepEqual(pencil.changedChunkIndices, [7]);
		const last = await store.readSourceChunk('pencil', 7);
		assert.equal(last.channels[0]![9], 0.5);
		assert.equal(last.channels[0]![8], 0.25);
		reads = 0;
		await persistImmutableSampleEdit({ store, source, smooth: { startFrame: frameCount - 12, endFrame: frameCount - 8, channel: 0 }, sourceId: 'smooth' });
		assert.equal(reads, 2, 'one context chunk and one changed chunk');
		assert.equal(releases, 3, 'every scoped source session releases');
		for await (const chunk of originalChunks('smooth')) assert.ok(chunk.channels[0]!.every(sample => sample === 0.25));
	} finally { await store.close(); }
});
