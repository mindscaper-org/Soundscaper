/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	async function fixture(context: test.TestContext) {
		const name = `sealed-read-${backend}-${crypto.randomUUID()}`;
		const database = backend === 'indexeddb' ? await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, name) : null;
		context.after(() => { database?.close(); });
		const port = { memory: getMemoryDatabase(name), database: async () => database };
		const values = new KeyValueRepository(port, 'analysis'), chunks = new SourceRecordRepository(port);
		const raw = new RawPcmSpoolRepository(values, chunks);
		const created = await raw.create({ projectId: 'project', spoolId: 'capture', sampleRate: 48_000, channelCount: 1, chunkFrames: 4, data: { phase: 'capturing' } });
		const appended = await raw.append(created, [Float32Array.of(0, -0, 0.25, 0.75)], { phase: 'capturing' });
		const sealed = await raw.seal(appended, { phase: 'sealed' });
		return { raw, values, chunks, sealed };
	}

	test(`${backend} sealed readers tolerate sibling writes and revalidate exact changed manifests`, async context => {
		const { raw, sealed } = await fixture(context), session = await raw.openReadSession(sealed);
		const other = await raw.create({ projectId: sealed.projectId, spoolId: 'other', sampleRate: 48_000, channelCount: 1, chunkFrames: 4, data: null });
		await raw.append(other, [Float32Array.of(1)], { phase: 'other' });
		assert.deepEqual((await session.chunk(0)).channels[0], Float32Array.of(0, -0, 0.25, 0.75));
		await raw.replaceData(sealed, { phase: 'changed' });
		await assert.rejects(session.chunk(0), /ownership changed/);
		await assert.rejects(raw.openReadSession(sealed), /ownership changed/);
	});

	test(`${backend} sealed readers reject ownership changes during actual PCM I/O and after removal`, async context => {
		const { raw, chunks, sealed } = await fixture(context), session = await raw.openReadSession(sealed);
		const chunk = chunks.chunk.bind(chunks);
		const replacement = context.mock.method(chunks, 'chunk', async (...args: Parameters<typeof chunk>) => {
			const result = await chunk(...args);
			await raw.replaceData(sealed, { phase: 'changed-during-read' });
			return result;
		});
		await assert.rejects(session.chunk(0), /ownership changed/);
		replacement.mock.restore();
		const current = await raw.load(sealed.projectId, sealed.spoolId);
		assert.ok(current);
		const next = await raw.openReadSession(current);
		assert.equal(await raw.remove(current), true);
		await assert.rejects(next.chunk(0), /ownership changed/);
	});

	test(`${backend} entry generation rotates only with successful stored writes and snapshots stay detached`, async context => {
		const { values } = await fixture(context);
		await values.put('setting', { option: true });
		const first = await values.captureGeneration('setting');
		assert.ok(first.generation);
		Reflect.set(first.value as object, 'option', false);
		assert.deepEqual(await values.get('setting'), { option: true });
		assert.equal(await values.replaceIfCurrent('setting', { option: false }, null), false);
		assert.equal(await values.getGeneration('setting'), first.generation);
		assert.equal(await values.replaceIfCurrent('setting', { option: true }, { option: true }), true);
		const second = await values.getGeneration('setting');
		assert.notEqual(second, first.generation);
		await values.put('setting', { option: true });
		assert.notEqual(await values.getGeneration('setting'), second);
		await values.deleteIfCurrent('setting', { option: true });
		assert.equal(await values.getGeneration('setting'), null);
	});
}
