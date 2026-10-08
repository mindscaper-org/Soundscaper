/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { RecordingRecoveryJournalRepository } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';

function fixture() {
	const rows = new Map<string, unknown>();
	const port = {
		get: (key: string) => structuredClone(rows.get(key)),
		putIfAbsent(key: string, value: unknown) { if (rows.has(key)) return false; rows.set(key, structuredClone(value)); return true; },
		replaceIfCurrent(key: string, expected: unknown, next: unknown) {
			if (JSON.stringify(rows.get(key)) !== JSON.stringify(expected)) return false;
			rows.set(key, structuredClone(next)); return true;
		},
		deleteIfCurrent(key: string, expected: unknown) {
			if (JSON.stringify(rows.get(key)) !== JSON.stringify(expected)) return false;
			return rows.delete(key);
		},
	};
	return { repository: new RecordingRecoveryJournalRepository(port), rows };
}
const destination = { trackId: 'track', startFrame: 20, sourceOffsetFrames: 2, sampleRate: 48_000, selection: null };
const segment = { sourceId: 'source', frameStart: 0, frameCount: 480_000, metadata: { name: 'Mic', channelCount: 1 } };

test('ordinary recording intent precedes capture and checkpoints survive repository restart', async () => {
	const { repository, rows } = fixture();
	const first = await repository.create('project', 'capture', { id: 'project', revision: 2 });
	const lane = await repository.addLane(first, 'lane', destination);
	const saved = await repository.append(lane, 'lane', segment);
	assert.equal(saved.lanes[0]?.segments.length, 1);
	assert.equal(saved.lanes[0]?.destination.sourceOffsetFrames, 2);
	assert.equal((await repository.load('project'))?.lanes[0]?.segments[0]?.sourceId, 'source');
	assert.equal(rows.size, 1);
	await assert.rejects(repository.create('project', 'other', { id: 'project' }), /already/u);
	await assert.rejects(repository.append(lane, 'lane', segment), /changed/u);
});

test('checkpoint journal refuses gaps and records a recovery target before its project publication', async () => {
	const { repository } = fixture();
	const first = await repository.create('project', 'capture', { id: 'project' });
	const lane = await repository.addLane(first, 'lane', destination);
	await assert.rejects(repository.append(lane, 'lane', { ...segment, frameStart: 10 }), /contiguous/u);
	const saved = await repository.append(lane, 'lane', segment);
	const decided = await repository.decide(saved, 'recover', { id: 'project' }, { id: 'project', revision: 1 });
	assert.deepEqual(decided.target, { id: 'project', revision: 1 });
	await assert.rejects(repository.decide(decided, 'discard'), /decision/u);
	await assert.rejects(repository.append(decided, 'lane', { ...segment, sourceId: 'next', frameStart: segment.frameCount }), /settling/u);
	await repository.remove(decided);
	assert.equal(await repository.load('project'), null);
});

test('journal rejects malformed destinations and checkpoint metadata without damaging the intent', async () => {
	const { repository } = fixture();
	const first = await repository.create('project', 'capture', { id: 'project' });
	await assert.rejects(repository.addLane(first, 'lane', { ...destination, sampleRate: -1 }), /sampleRate/u);
	const lane = await repository.addLane(first, 'lane', destination);
	await assert.rejects(repository.append(lane, 'lane', { ...segment, frameCount: 0 }), /frameCount/u);
	assert.equal((await repository.load('project'))?.lanes[0]?.segments.length, 0);
});
