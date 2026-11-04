/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository, type ProjectDocument } from '../src/common/editor/storage/project-repository.ts';
import { ProjectCompareAndSwapRepository } from '../src/common/editor/storage/project-compare-and-swap-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

async function fixture(count = 73) {
	const indexedDB = createInstrumentedIndexedDB();
	const name = `pending-publication-${globalThis.crypto.randomUUID()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, name);
	const work = { active: 0, maximum: 0, reads: 0 };
	const observed = new Proxy(database, {
		get(target, key, receiver) {
			if (key !== 'transaction') return Reflect.get(target, key, receiver) as unknown;
			return (...args: Parameters<IDBDatabase['transaction']>): IDBTransaction => {
				const transaction = target.transaction(...args);
				const objectStore = transaction.objectStore.bind(transaction);
				transaction.objectStore = (storeName: string): IDBObjectStore => {
					const store = objectStore(storeName);
					if (storeName !== 'sources' && storeName !== 'mediaAssets') return store;
					const get = store.get.bind(store);
					store.get = (query: IDBValidKey | IDBKeyRange): IDBRequest<unknown> => {
						const request: IDBRequest<unknown> = get(query);
						work.active++; work.reads++; work.maximum = Math.max(work.maximum, work.active);
						let settled = false;
						for (const field of ['onsuccess', 'onerror'] as const) {
							let handler: typeof request.onsuccess = null;
							Object.defineProperty(request, field, {
								get: () => (event: Event) => {
									if (!settled) { settled = true; work.active--; }
									handler?.call(request, event);
								},
								set: (value: typeof request.onsuccess) => { handler = value; },
							});
						}
						return request;
					};
					return store;
				};
				return transaction;
			};
		},
	});
	const port = { memory: getMemoryDatabase(name), database: async () => observed };
	const ordinary = new ProjectRepository(port, 3);
	const cas = new ProjectCompareAndSwapRepository(ordinary, port, 3);
	const project: ProjectDocument = { id: 'project', revision: 0,
		sources: Array.from({ length: count }, (_, index) => ({ id: `logical-${index}`, storageKey: `physical-${index}` })),
	};
	function seedPending(): void {
		for (const store of ['sources', 'mediaAssets']) for (let index = 0; index <= count; index++) {
			indexedDB.seedRecord(name, store, { id: `physical-${index}`, sourceId: `physical-${index}`, pendingProjectUntil: '2099-01-01', generation: 7,
				metadata: { retained: store, content: new Uint8Array([index % 256, 42]) } });
		}
	}
	seedPending();
	return { indexedDB, name, database, ordinary, cas, project, work, count, seedPending };
}

for (const route of ['ordinary', 'cas', 'create'] as const) test(`${route} publication batches fresh metadata reads with a hard bound`, async () => {
	const f = await fixture();
	try {
		let expected = f.project;
		if (route === 'cas') { expected = await f.ordinary.save(f.project); f.seedPending(); }
		f.work.active = 0; f.work.reads = 0; f.work.maximum = 0;
		const next = { ...f.project, revision: 1 };
		const result = route === 'ordinary' ? await f.ordinary.save(next)
			: route === 'cas' ? await f.cas.saveIfCurrent(expected, next)
			: await f.ordinary.createForScapeImportIfAbsent(next);
		assert.deepEqual(result, next);
		assert.equal(f.work.reads, f.count * 2);
		assert.ok(f.work.maximum >= 16, `${f.work.maximum} outstanding metadata reads still serialize publication`);
		assert.ok(f.work.maximum <= 32, 'Metadata request retention must remain bounded independently of project size.');
		for (const store of ['sources', 'mediaAssets']) {
			const records = f.indexedDB.records(f.name, store) as Array<{ id: string; pendingProjectUntil?: string; generation: number }>;
			assert.equal(records.filter(record => record.pendingProjectUntil === undefined).length, f.count, `${store}: ${JSON.stringify(records.slice(0, 2))}`);
			assert.equal(records.find(record => record.id === `physical-${f.count}`)?.pendingProjectUntil, '2099-01-01');
			assert.ok(records.every(record => record.generation === 7));
		}
		assert.equal(f.indexedDB.stats.getAllRequests.filter((entry: { store: string }) => ['sources', 'mediaAssets'].includes(entry.store)).length, 0);
	} finally { f.database.close(); }
});

for (const route of ['ordinary', 'cas', 'create'] as const) test(`${route} publication rolls back all document and metadata rows on a batch write failure`, async () => {
	const f = await fixture(33);
	try {
		let expected = f.project;
		if (route !== 'create') { expected = await f.ordinary.save(f.project); f.seedPending(); }
		const names = ['projects', 'revisions', 'sources', 'mediaAssets'];
		const before = names.map(name => f.indexedDB.records(f.name, name));
		const failure = new Error('Planned publication metadata write failure');
		f.indexedDB.failNextPutForStore('mediaAssets', failure);
		const next = { ...f.project, revision: 1 };
		const pending = route === 'ordinary' ? f.ordinary.save(next)
			: route === 'cas' ? f.cas.saveIfCurrent(expected, next)
			: f.ordinary.createForScapeImportIfAbsent(next);
		await assert.rejects(pending, error => error === failure);
		assert.deepEqual(names.map(name => f.indexedDB.records(f.name, name)), before);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.database.close(); }
});

test('a rejected metadata read aborts project publication and preserves every staging root', async () => {
	const f = await fixture(33);
	try {
		const expected = await f.ordinary.save(f.project); f.seedPending();
		const names = ['projects', 'revisions', 'sources', 'mediaAssets'];
		const before = names.map(name => f.indexedDB.records(f.name, name));
		const failure = new Error('Planned metadata read failure');
		f.indexedDB.onNextGetForStore('mediaAssets', () => { throw failure; });
		await assert.rejects(f.cas.saveIfCurrent(expected, { ...expected, revision: 1 }), error => error === failure);
		assert.deepEqual(names.map(name => f.indexedDB.records(f.name, name)), before);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.database.close(); }
});

test('CAS and creation conflicts leave metadata unread and staged', async () => {
	const f = await fixture(33);
	try {
		const expected = await f.ordinary.save(f.project); f.seedPending();
		const next = { ...expected, revision: 1 };
		f.work.reads = 0;
		assert.equal(await f.cas.saveIfCurrent({ ...expected, revision: 99 }, next), null);
		assert.equal(f.work.reads, 0);
		const fence = await f.cas.claimWriteFence(expected.id);
		assert.equal(await f.cas.saveIfCurrentAndFenced(expected, next, `${fence}-retired`), null);
		assert.equal(f.work.reads, 0);
		assert.equal(await f.ordinary.createForScapeImportIfAbsent(next), null);
		assert.equal(f.work.reads, 0);
		for (const store of ['sources', 'mediaAssets']) assert.ok(f.indexedDB.records(f.name, store)
			.every((record: { pendingProjectUntil?: string }) => record.pendingProjectUntil === '2099-01-01'));
		assert.deepEqual(await f.cas.saveIfCurrentAndFenced(expected, next, fence), next);
		assert.equal(f.work.reads, f.count * 2);
	} finally { f.database.close(); }
});

test('later publications read replacement metadata freshly and never create missing records', async () => {
	const f = await fixture(1);
	try {
		await f.ordinary.save(f.project);
		for (const store of ['sources', 'mediaAssets']) f.indexedDB.seedRecord(f.name, store, {
			id: 'physical-0', sourceId: 'physical-0', generation: 8, contentSha256: 'replacement', pendingProjectUntil: '2099-02-01',
			metadata: { retained: store, content: new Uint8Array([1, 2, 3]) },
		});
		f.work.reads = 0;
		const next = { ...f.project, revision: 1, sources: [
			{ id: 'logical-0', storageKey: 'physical-0' }, { id: 'missing-logical', storageKey: 'missing-physical' },
		] };
		const committed = await f.ordinary.save(next);
		assert.equal(f.work.reads, 4);
		for (const store of ['sources', 'mediaAssets']) {
			const records = f.indexedDB.records(f.name, store) as Array<Record<string, unknown>>;
			assert.equal(records.length, 2);
			const published = records.find(record => record.id === 'physical-0'); assert.ok(published);
			assert.equal(published.pendingProjectUntil, undefined);
			assert.equal(published.generation, 8);
			assert.equal(published.contentSha256, 'replacement');
			assert.deepEqual(published.metadata, { retained: store, content: new Uint8Array([1, 2, 3]) });
		}
		next.sources[0]!.storageKey = 'caller-mutation';
		(committed.sources as Array<{ storageKey: string }>)[0]!.storageKey = 'returned-mutation';
		assert.equal(((await f.ordinary.load(next.id))?.sources as Array<{ storageKey: string }>)[0]!.storageKey, 'physical-0');
	} finally { f.database.close(); }
});

test('a later metadata batch failure rolls back earlier batches in the original publication transaction', async () => {
	const f = await fixture(33);
	try {
		await f.ordinary.save(f.project); f.seedPending();
		const names = ['projects', 'revisions', 'sources', 'mediaAssets'];
		const before = names.map(name => f.indexedDB.records(f.name, name));
		const failure = new Error('The second metadata batch failed');
		let reads = 0, earlierBatchWritten = false;
		function observe(): void {
			reads++;
			if (reads === 17) {
				earlierBatchWritten = f.indexedDB.records(f.name, 'sources')
					.filter((record: { pendingProjectUntil?: string }) => record.pendingProjectUntil === undefined).length === 16;
				throw failure;
			}
			f.indexedDB.onNextGetForStore('sources', observe);
		}
		f.indexedDB.onNextGetForStore('sources', observe);
		await assert.rejects(f.ordinary.save({ ...f.project, revision: 1 }), error => error === failure);
		assert.ok(earlierBatchWritten, 'The refusal must follow completed writes from the first batch.');
		assert.deepEqual(names.map(name => f.indexedDB.records(f.name, name)), before);
	} finally { f.database.close(); }
});
