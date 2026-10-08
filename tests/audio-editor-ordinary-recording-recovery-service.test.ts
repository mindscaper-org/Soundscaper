/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { RecordingRecoveryJournalRepository } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { createOrdinaryRecordingRecoveryService } from '../src/common/editor/controller/recording/internal/ordinary-recording-recovery-service.ts';

function fixture() {
	const rows = new Map<string, unknown>();
	const repository = new RecordingRecoveryJournalRepository({
		get: (key) => structuredClone(rows.get(key)),
		putIfAbsent(key, value) { if (rows.has(key)) return false; rows.set(key, structuredClone(value)); return true; },
		replaceIfCurrent(key, expected, next) { if (JSON.stringify(rows.get(key)) !== JSON.stringify(expected)) return false; rows.set(key, structuredClone(next)); return true; },
		deleteIfCurrent(key, expected) { if (JSON.stringify(rows.get(key)) !== JSON.stringify(expected)) return false; return rows.delete(key); },
	});
	let project = { id: 'project', revision: 0, sourceIds: [] as string[] };
	let live = structuredClone(project);
	let writable = true;
	let publicationFailure = false;
	let preparedLoss = 0;
	let sharedRecovery = false;
	const reportedLoss: number[] = [];
	const deleted: string[] = [];
	const service = () => createOrdinaryRecordingRecoveryService({
		repository,
		getProjectId: () => project.id,
		assertWritable: () => { if (!writable) throw new Error('read-only'); },
		loadProject: async () => structuredClone(project),
		prepareTarget: async (base, journal) => ({ ...base, revision: Number(base.revision) + 1, sourceIds: journal.lanes.flatMap(({ segments }) => segments.map(({ sourceId }) => sourceId)) }),
		saveIfCurrent: async (base, target) => {
			if (JSON.stringify(base) !== JSON.stringify(project)) return null;
			project = structuredClone(target) as typeof project;
			return target;
		},
		getPreparedLoss: () => preparedLoss,
		publish: async (_base, _target, journal) => { if (publicationFailure) throw new Error('renderer died'); reportedLoss.push(journal.lostCheckpointCount); },
		restoreProject: async (project) => { if (publicationFailure) throw new Error('renderer died'); live = structuredClone(project) as typeof live; },
		isPublished: (project, journal) => journal.lanes.every(({ segments }) => segments.every(({ sourceId }) => (project.sourceIds as string[]).includes(sourceId))),
		isComplete: (project, journal) => journal.lanes.every(({ destination, segments }) => segments.every(({ sourceId, frameStart, frameCount }) => frameStart + frameCount <= destination.sourceOffsetFrames || (project.sourceIds as string[]).includes(sourceId))),
		deleteSource: async (sourceId) => { if (sharedRecovery) throw new Error(`Source ${sourceId} is retained by recording recovery.`); assert.ok(!live.sourceIds.includes(sourceId), 'live project must release discarded clips before checkpoint deletion'); deleted.push(sourceId); },
	});
	return { service, repository, deleted, reportedLoss, preparedLoss(value: number) { preparedLoss = value; }, sharedRecovery(value: boolean) { sharedRecovery = value; }, project: () => project, live: () => live, unpublishedStop() { live = { ...live, revision: 1, sourceIds: ['source'] }; }, writable(value: boolean) { writable = value; }, failPublication(value: boolean) { publicationFailure = value; } };
}
const destination = { trackId: 'track', startFrame: 20, sourceOffsetFrames: 2, sampleRate: 48_000, selection: null };
const checkpoint = { sourceId: 'source', frameStart: 0, frameCount: 480_000, metadata: { name: 'Mic', channelCount: 1 } };

test('a fresh recovery service restores durable ordinary checkpoints exactly once after a crash', async () => {
	const f = fixture(); const capture = f.service();
	await capture.begin('capture');
	await capture.addLane('lane', destination);
	await capture.checkpoint('lane', checkpoint);
	const recovered = f.service();
	const pending = await recovered.inspect('project'); assert.ok(pending);
	assert.equal(pending.checkpointCount, 1);
	await recovered.resolve(pending, 'recover');
	assert.deepEqual(f.project().sourceIds, ['source']);
	assert.equal(f.project().revision, 1);
	assert.equal(await recovered.inspect('project'), null);
	assert.deepEqual(f.deleted, []);
});

test('normal finalization defers cleanup of checkpoint bytes until the visible recording prefix is durably published', async () => {
	const f = fixture(); const capture = f.service();
	await capture.begin('capture'); await capture.addLane('lane', { ...destination, sourceOffsetFrames: checkpoint.frameCount }); await capture.checkpoint('lane', checkpoint);
	await capture.deleteCapturedSource(checkpoint.sourceId);
	assert.deepEqual(f.deleted, []);
	assert.ok(await f.repository.load('project'));
	await capture.complete();
	assert.equal(await f.repository.load('project'), null);
	await capture.deleteCapturedSource(checkpoint.sourceId);
	assert.deepEqual(f.deleted, ['source']);
});

test('discard after a Stop save failure restores the durable project before deleting audio and is retryable', async () => {
	const f = fixture(); const capture = f.service();
	await capture.begin('capture'); await capture.addLane('lane', destination); await capture.checkpoint('lane', checkpoint);
	f.unpublishedStop();
	const pending = await capture.inspect('project'); assert.ok(pending);
	f.failPublication(true);
	await assert.rejects(capture.resolve(pending, 'discard'), /renderer died/u);
	assert.deepEqual(f.deleted, []);
	assert.equal((await f.repository.load('project'))?.decision, 'discard');
	f.failPublication(false);
	const retry = f.service(); const retryPending = await retry.inspect('project'); assert.ok(retryPending);
	await retry.resolve(retryPending, 'discard');
	assert.deepEqual(f.live(), f.project());
	assert.deepEqual(f.deleted, ['source']);
	assert.equal(await retry.inspect('project'), null);
});

test('recovery retries a committed project after a renderer failure without creating duplicate clips', async () => {
	const f = fixture(); const capture = f.service();
	await capture.begin('capture'); await capture.addLane('lane', destination); await capture.checkpoint('lane', checkpoint);
	const recovered = f.service(); const pending = await recovered.inspect('project'); assert.ok(pending);
	f.preparedLoss(1); f.failPublication(true);
	await assert.rejects(recovered.resolve(pending, 'recover'), /renderer died/u);
	assert.equal(f.project().revision, 1);
	assert.equal((await f.repository.load('project'))?.decision, 'recover');
	assert.equal((await f.repository.load('project'))?.lostCheckpointCount, 1);
	f.failPublication(false);
	const retry = f.service(); const retryPending = await retry.inspect('project'); assert.ok(retryPending);
	await retry.resolve(retryPending, 'recover');
	assert.equal(f.project().revision, 1);
	assert.equal(await retry.inspect('project'), null);
	assert.deepEqual(f.reportedLoss, [1]);
});

test('discarding a repaired-copy recording settles its journal while the original journal keeps shared audio protected', async () => {
	const f = fixture(); const capture = f.service();
	await capture.begin('capture'); await capture.addLane('lane', destination); await capture.checkpoint('lane', checkpoint);
	f.sharedRecovery(true);
	const pending = await capture.inspect('project'); assert.ok(pending);
	await capture.resolve(pending, 'discard');
	assert.equal(await capture.inspect('project'), null);
	assert.deepEqual(f.deleted, []);
});

test('read-only and stale generation decisions cannot mutate or delete recovery audio', async () => {
	const f = fixture(); const capture = f.service();
	await capture.begin('capture'); await capture.addLane('lane', destination); await capture.checkpoint('lane', checkpoint);
	const pending = await capture.inspect('project'); assert.ok(pending);
	f.writable(false); await assert.rejects(capture.resolve(pending, 'discard'), /read-only/u);
	assert.deepEqual(f.deleted, []);
	f.writable(true); await assert.rejects(capture.resolve({ ...pending, recoveryToken: 'other' }, 'discard'), /stale/u);
	await capture.resolve(pending, 'discard');
	assert.deepEqual(f.deleted, ['source']);
	assert.equal(await capture.inspect('project'), null);
	assert.deepEqual(f.project().sourceIds, []);
});
