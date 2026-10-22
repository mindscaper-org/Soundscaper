/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOrdinaryRecordingRecoveryPrefix } from '../src/common/editor/controller/recording/internal/ordinary-recording-recovery-prefix.ts';
import { normalizeRecordingRecoveryJournal } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { createProjectStore } from '../src/common/editor/storage.js';

const journal = () => normalizeRecordingRecoveryJournal({ version: 1, projectId: 'project', id: 'capture', base: { id: 'project' }, decision: null, target: null, targetBase: null,
	lanes: [{ id: 'lane', destination: { trackId: 'track', startFrame: 20, sourceOffsetFrames: 2, sampleRate: 48_000, selection: null },
		segments: ['first', 'last'].map((sourceId, index) => ({ sourceId, frameStart: index * 4, frameCount: 4, metadata: { name: 'Mic', channelCount: 1 } })) }] });

test('missing final checkpoint metadata preserves the complete validated recording prefix', async () => {
	const original = journal();
	const result = await validateOrdinaryRecordingRecoveryPrefix(original, {
		getMetadata: (id) => Promise.resolve(id === 'first' ? { id, frameCount: 4, sampleRate: 48_000, channelCount: 1 } : null),
		async *chunks() { yield { frames: 4, channels: [Float32Array.of(0.1, 0.2, 0.3, 0.4)] }; },
	});
	assert.equal(result.lostCheckpointCount, 1);
	assert.deepEqual(result.journal.lanes[0]?.segments.map(({ sourceId }) => sourceId), ['first']);
	assert.equal(original.lanes[0]?.segments.length, 2);
});

test('a truncated final source body loses only that checkpoint while all previous PCM remains recoverable', async () => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `recovery-prefix-${crypto.randomUUID()}` });
	try {
		for (const id of ['first', 'last']) {
			const writer = await store.beginSourceWrite(id, { sampleRate: 48_000, channelCount: 1 });
			await writer.write([Float32Array.of(0.125, 0.25, 0.375, 0.5)]); await writer.commit();
		}
		const last = await store.getSourceMetadata('last'); assert.ok(last);
		for (const [key, chunk] of store.memory.sourceChunks) if ((chunk as { sourceToken?: string }).sourceToken === last.sourceToken) store.memory.sourceChunks.delete(key);
		const result = await validateOrdinaryRecordingRecoveryPrefix(journal(), store.sourceRepository);
		assert.equal(result.lostCheckpointCount, 1);
		assert.deepEqual(result.journal.lanes[0]?.segments.map(({ sourceId }) => sourceId), ['first']);
		const pcm: number[] = []; for await (const chunk of store.readSourceChunks('first')) pcm.push(...chunk.channels[0]!);
		assert.deepEqual(pcm, [0.125, 0.25, 0.375, 0.5]);
	} finally { await store.close(); }
});

test('middle gaps, cancellation, storage unavailability and ownership loss never become accepted checkpoint loss', async () => {
	const port = { getMetadata: (id: string) => Promise.resolve({ id, frameCount: 4, sampleRate: 48_000, channelCount: 1 }),
		async *chunks() { yield { frames: 4, channels: [new Float32Array(4)] }; } };
	await assert.rejects(validateOrdinaryRecordingRecoveryPrefix(journal(), { ...port, getMetadata: (id) => Promise.resolve(id === 'first' ? null : { id, frameCount: 4, sampleRate: 48_000, channelCount: 1 }) }), /checkpoint/u);
	for (const failure of [Object.assign(new Error('Cancelled'), { name: 'AbortError' }), new Error('Origin-private audio storage is unavailable.'), new Error('Source storage ownership changed.')]) {
		await assert.rejects(validateOrdinaryRecordingRecoveryPrefix(journal(), { ...port, async *chunks(id) { if (id === 'last') throw failure; yield { frames: 4, channels: [new Float32Array(4)] }; } }), (error) => error === failure);
	}
});
