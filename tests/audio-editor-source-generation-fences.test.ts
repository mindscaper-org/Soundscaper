/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { sameStoredSourceIdentity, type StorageRecord } from '../src/common/editor/storage/media-records.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} fresh generation fences retain all six identity fields in one detached snapshot`, async context => {
		const name = `scalar-fence-${backend}-${crypto.randomUUID()}`;
		const database = backend === 'indexeddb' ? await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, name) : null;
		context.after(() => { database?.close(); });
		const records = new SourceRecordRepository({ memory: getMemoryDatabase(name), database: async () => database });
		const source: StorageRecord = { id: 'source', storage: 'copy-on-write', sourceToken: 'one', path: 'path',
			baseSourceId: 'base', pcmEncodingVersion: 1, sampleBlockChannels: [[{ start: 0, frameCount: 64 }]] };
		await records.putMetadata(source);
		const transactions = database ? context.mock.method(database, 'transaction') : null;
		const fences = await records.getGenerationFences(['source', 'missing', 'source']);
		assert.equal(transactions?.mock.callCount() ?? 1, 1);
		assert.deepEqual(fences[0], { id: 'source', storage: 'copy-on-write', sourceToken: 'one', path: 'path', baseSourceId: 'base', pcmEncodingVersion: 1 });
		assert.equal(fences[1], null);
		assert.notEqual(fences[0], fences[2]);
		assert.ok(sameStoredSourceIdentity(fences[0], source));
		Reflect.set(fences[0]!, 'sourceToken', 'caller-change');
		assert.equal((await records.getGenerationFences(['source']))[0]!.sourceToken, 'one');
		for (const [field, value] of Object.entries({ id: 'replacement', storage: 'opfs', sourceToken: 'two', path: 'other', baseSourceId: 'other-base', pcmEncodingVersion: 2 })) {
			// The repository is queried again; no open-time metadata substitutes for current storage.
			await records.putMetadata({ ...source, [field]: value });
			const current = (await records.getGenerationFences([field === 'id' ? 'replacement' : 'source']))[0]!;
			assert.equal(sameStoredSourceIdentity(current, source), false, field);
		}
		assert.deepEqual((await records.getMetadata('source'))!.sampleBlockChannels, source.sampleBlockChannels);
	});
}
