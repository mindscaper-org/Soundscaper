/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { RecordingRecoveryJournalRepository } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} retains recording checkpoints past the orphan grace period until an explicit decision`, async () => {
		const store = createProjectStore({ indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null, preferOpfs: false, databaseName: `recording-retention-${crypto.randomUUID()}` });
		try {
			const writer = await store.beginSourceWrite('checkpoint', { sampleRate: 48_000, name: 'Mic' });
			await writer.write([Float32Array.of(0.25)]); await writer.commit();
			const repository = new RecordingRecoveryJournalRepository(store.analysisRepository);
			let journal = await repository.create('project', 'capture', { id: 'project' });
			journal = await repository.addLane(journal, 'lane', { trackId: 'track', startFrame: 0, sourceOffsetFrames: 0, sampleRate: 48_000, selection: null });
			journal = await repository.append(journal, 'lane', { sourceId: 'checkpoint', frameStart: 0, frameCount: 1, metadata: { name: 'Mic' } });
			await assert.rejects(store.deleteSource('checkpoint'), /recording recovery/u);
			await assert.rejects(store.discardSourceIfCurrent((await store.getSourceMetadata('checkpoint'))!), /recording recovery/u);
			const result = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: Date.now() + 7 * 24 * 60 * 60 * 1000 });
			assert.deepEqual(result.deletedSourceIds, []);
			assert.ok(await store.getSourceMetadata('checkpoint'));
			journal = await repository.decide(journal, 'discard');
			await store.deleteSource('checkpoint');
			await repository.remove(journal);
			assert.equal(await store.getSourceMetadata('checkpoint'), null);
		} finally { await store.close(); }
	});
}

test('garbage collection preserves raw damaged project and revision source inventories', async () => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `damaged-retention-${crypto.randomUUID()}` });
	try {
		await store.ready();
		const damaged = { id: 'damaged', schemaFamily: 'soundscaper', schemaVersion: 1, sources: [{ id: 'recoverable' }], tracks: {}, clips: [] };
		store.memory.projects.set('damaged', structuredClone(damaged));
		store.memory.revisions.set('damaged:1', { key: 'damaged:1', projectId: 'damaged', revision: 1, project: { ...damaged, id: 'damaged', sources: [{ id: 'older' }], clips: {} } });
		for (const id of ['recoverable', 'older']) store.memory.sources.set(id, { id, storage: 'indexeddb-chunks', sourceToken: id, committedAt: '2020-01-01T00:00:00.000Z' });
		const result = await store.pruneUnreferencedSources({ minimumAgeMs: 0 });
		assert.deepEqual(result.deletedSourceIds, []);
		assert.deepEqual(store.memory.projects.get('damaged'), damaged);
		assert.ok(store.memory.sources.has('older'));
	} finally { await store.close(); }
});

test('semantic Soundscaper corruption preserves the complete raw source inventory through cleanup and public deletion', async () => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	try {
		await store.ready();
		const track = createAudioTrack({ id: 'semantic-track' });
		const original = createSoundscaperProject({ id: 'semantic-damaged', tracks: [track], sources: [createAudioSource({ id: 'semantic-checkpoint', frameCount: 1, channelCount: 1, sampleRate: 48_000 })] });
		const damaged = { ...original, tracks: [{ ...original.tracks[0], gain: -999 }] };
		store.memory.projects.set(original.id, structuredClone(damaged));
		store.memory.sources.set('semantic-checkpoint', { id: 'semantic-checkpoint', storage: 'indexeddb-chunks', sourceToken: 'semantic-checkpoint', committedAt: '2020-01-01T00:00:00.000Z' });
		const result = await store.pruneUnreferencedSources({ minimumAgeMs: 0 });
		assert.deepEqual(result.deletedSourceIds, []);
		assert.deepEqual(store.memory.projects.get(original.id), damaged);
		await assert.rejects(store.deleteSource('semantic-checkpoint'), /saved project/u);
		await assert.rejects(store.discardSourceIfCurrent((await store.getSourceMetadata('semantic-checkpoint'))!), /saved project/u);
	} finally { await store.close(); }
});
