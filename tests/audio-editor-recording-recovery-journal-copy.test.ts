/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { RecordingRecoveryJournalRepository } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { copyOrdinaryRecordingRecoveryToProject } from '../src/common/editor/storage/recording-recovery-journal-copy.ts';

test('repair copies an undecided journal under an exact origin fence without changing the original or duplicating retries', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const repository = new RecordingRecoveryJournalRepository(store.analysisRepository);
	let journal = await repository.create('original', 'capture', { id: 'original', revision: 2 });
	journal = await repository.addLane(journal, 'mic', { trackId: 'removed-track', startFrame: 100, sourceOffsetFrames: 5, sampleRate: 48_000, selection: null });
	journal = await repository.append(journal, 'mic', { sourceId: 'checkpoint', frameStart: 0, frameCount: 480_000, metadata: { name: 'Mic', channelCount: 1 } });
	const repaired = { id: 'repaired', revision: 0, tracks: [] };
	await copyOrdinaryRecordingRecoveryToProject(store.analysisRepository, 'original', repaired);
	await copyOrdinaryRecordingRecoveryToProject(store.analysisRepository, 'original', repaired);
	assert.deepEqual(await repository.load('original'), journal);
	const copied = await repository.load('repaired'); assert.ok(copied);
	assert.equal(copied.id, journal.id);
	assert.deepEqual(copied.base, repaired);
	assert.deepEqual(copied.lanes, journal.lanes);
	const unrelated = await repository.create('other', 'other-capture', { id: 'other' });
	await assert.rejects(copyOrdinaryRecordingRecoveryToProject(store.analysisRepository, 'original', { id: 'other' }), /different recording/u);
	assert.deepEqual(await repository.load('other'), unrelated);
});

test('journal copying fails closed when the original advances and preserves a completed discard choice', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const repository = new RecordingRecoveryJournalRepository(store.analysisRepository);
	const journal = await repository.create('raced-original', 'capture', { id: 'raced-original' });
	const port = {
		get: store.analysisRepository.get.bind(store.analysisRepository),
		async replaceIfCurrentAndPutIfAbsent() { await repository.addLane(journal, 'new-lane', { trackId: 'track', startFrame: 0, sourceOffsetFrames: 0, sampleRate: 48_000, selection: null }); return false; },
	};
	await assert.rejects(copyOrdinaryRecordingRecoveryToProject(port, 'raced-original', { id: 'raced-repaired' }), /changed/u);
	assert.equal(await repository.load('raced-repaired'), null);
	const latest = await repository.load('raced-original'); assert.ok(latest);
	const discarded = await repository.decide(latest, 'discard');
	await copyOrdinaryRecordingRecoveryToProject(store.analysisRepository, 'raced-original', { id: 'raced-repaired' });
	assert.equal(await repository.load('raced-repaired'), null);
	assert.deepEqual(await repository.load('raced-original'), discarded);
});

test('project repair can reconnect checkpoints after an interrupted recovery publication', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const repository = new RecordingRecoveryJournalRepository(store.analysisRepository);
	const base = { id: 'decided-original', revision: 4 };
	let journal = await repository.create(base.id, 'capture', base);
	journal = await repository.addLane(journal, 'mic', { trackId: 'track', startFrame: 0, sourceOffsetFrames: 0, sampleRate: 48_000, selection: null });
	journal = await repository.append(journal, 'mic', { sourceId: 'checkpoint', frameStart: 0, frameCount: 480_000, metadata: { channelCount: 1 } });
	journal = await repository.decide(journal, 'recover', base, { ...base, revision: 5 });
	const repaired = { id: 'decided-repaired', revision: 0 };
	await copyOrdinaryRecordingRecoveryToProject(store.analysisRepository, base.id, repaired);
	const copied = await repository.load(repaired.id); assert.ok(copied);
	assert.deepEqual(copied.lanes, journal.lanes);
	assert.deepEqual(copied.base, repaired);
	assert.equal(copied.decision, null);
	assert.equal(copied.target, null);
	assert.equal(copied.targetBase, null);
	assert.deepEqual(await repository.load(base.id), journal);
});
