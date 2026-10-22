/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createIndexedDbDebugOutputCurrentV1 } from '../src/lightscaper/quality/photo-library-debug-indexeddb-output-current-v1.ts';
import { isDebugCleanupFailureCurrentV1 } from '../src/lightscaper/quality/photo-library-debug-soak-contract-current-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const NAME = 'lightscaper-library-debug-outputs-v1', LIMIT = 8 * 1024 * 1024;
const TOKEN = '99c26fd4-dd16-4a70-9477-f084ac1d3477', OTHER = 'a8866c21-8ae4-4932-8be3-656282828228';
type Harness = ReturnType<typeof createInstrumentedIndexedDB>;
type Row = Readonly<{ token: string; bytes: ArrayBuffer | null }>;
const rows = (raw: Harness): readonly Row[] => raw.records(NAME, 'outputs') as unknown as readonly Row[];

function factoryFor(raw: Harness, inspect: (database: IDBDatabase) => void): IDBFactory {
	return { open(name: string, version?: number) {
		const opening = raw.open(name, version) as unknown as IDBOpenDBRequest;
		let success: IDBOpenDBRequest['onsuccess'] = null;
		Object.defineProperty(opening, 'onsuccess', {
			set(value: IDBOpenDBRequest['onsuccess']) { success = value; },
			get() { return (event: Event) => { inspect(opening.result); success?.call(opening, event); }; },
		});
		return opening;
	} } as IDBFactory;
}

function holdCompletion(database: IDBDatabase, mode: IDBTransactionMode) {
	const entered = deferred<void>(), release = deferred<void>(), native = database.transaction.bind(database);
	let held = false;
	database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		const transaction = native(...args);
		if (args[1] === mode && !held) {
			held = true; let complete: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(transaction, 'oncomplete', {
				set(value: IDBTransaction['oncomplete']) { complete = value; },
				get() { return (event: Event) => { entered.resolve(); void release.promise.then(() => complete?.call(transaction, event)); }; },
			});
		}
		return transaction;
	}) as IDBDatabase['transaction'];
	return { entered, release, restore() { database.transaction = native; } };
}

function observeBuffers(database: IDBDatabase) {
	const written: ArrayBuffer[] = [], read: ArrayBuffer[] = [], native = database.transaction.bind(database);
	database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		const transaction = native(...args), objectStore = transaction.objectStore.bind(transaction);
		transaction.objectStore = (name: string) => {
			const store = objectStore(name), put = store.put.bind(store), get = store.get.bind(store);
			store.put = ((value: unknown, key?: IDBValidKey) => {
				const row = value as Partial<Row>; if (row.bytes instanceof ArrayBuffer) written.push(row.bytes);
				return put(value, key);
			}) as IDBObjectStore['put'];
			store.get = (key: IDBValidKey | IDBKeyRange) => {
				const request = get(key); let success: IDBRequest['onsuccess'] = null;
				Object.defineProperty(request, 'onsuccess', {
					set(value: IDBRequest['onsuccess']) { success = value; },
					get() { return (event: Event) => {
						const row = request.result as Partial<Row> | undefined;
						if (row?.bytes instanceof ArrayBuffer) read.push(row.bytes);
						success?.call(request, event);
					}; },
				});
				return request;
			};
			return store;
		};
		return transaction;
	}) as IDBDatabase['transaction'];
	return { written, read };
}

test('IndexedDB diagnostic output commits copied ArrayBuffer bytes and constructs each Blob from fresh persistent readback', async () => {
	const raw = createInstrumentedIndexedDB(); let observed!: ReturnType<typeof observeBuffers>;
	const stage = await createIndexedDbDebugOutputCurrentV1(factoryFor(raw, database => { observed = observeBuffers(database); }), TOKEN);
	const foreign = new TextEncoder().encode('foreign').buffer; raw.seedRecord(NAME, 'outputs', { token: OTHER, bytes: foreign });
	try {
		assert.deepEqual(rows(raw).find(row => row.token === TOKEN), { token: TOKEN, bytes: null });
		await assert.rejects(stage.read(), /committed/u);
		const writer = await stage.createWritable(), input = Uint8Array.of(1, 2, 3, 4);
		await writer.write(input.subarray(1, 3)); input.fill(9);
		await writer.write(Uint8Array.of(5)); await writer.close();
		const stored = rows(raw).find(row => row.token === TOKEN)!;
		assert.ok(stored.bytes instanceof ArrayBuffer); assert.deepEqual(new Uint8Array(stored.bytes), Uint8Array.of(2, 3, 5));
		assert.equal(Object.hasOwn(stored, 'blob'), false, 'the durable row never depends on nested Blob serialization');
		assert.equal(observed.written.length, 1); assert.equal(new Uint8Array(observed.written[0]!).every(value => value === 0), true);
		const first = await stage.read(), second = await stage.read();
		assert.notEqual(first, second, 'each read constructs a new native Blob from its own transaction result');
		assert.equal(first.type, 'image/png');
		assert.deepEqual(new Uint8Array(await first.arrayBuffer()), Uint8Array.of(2, 3, 5));
		assert.deepEqual(new Uint8Array(await second.arrayBuffer()), Uint8Array.of(2, 3, 5));
		assert.equal(observed.read.length, 2); assert.notEqual(observed.read[0], observed.read[1]);
		assert.equal(observed.read.every(bytes => new Uint8Array(bytes).every(value => value === 0)), true, 'retrieved scratch bytes are wiped after Blob copies');
		assert.deepEqual(new Uint8Array(rows(raw).find(row => row.token === TOKEN)!.bytes!), Uint8Array.of(2, 3, 5), 'scratch wiping cannot change the durable row');
		raw.seedRecord(NAME, 'outputs', { token: TOKEN, bytes: Uint8Array.of(6).buffer });
		assert.deepEqual(new Uint8Array(await (await stage.read()).arrayBuffer()), Uint8Array.of(6), 'read uses the stored row rather than a memory shadow');
		assert.deepEqual(new Uint8Array(await first.arrayBuffer()), Uint8Array.of(2, 3, 5), 'later row mutation cannot change a returned Blob');
		await assert.rejects(stage.createWritable(), /writer/u);
		assert.equal(raw.stats.activeTransactions, 0);
	} finally { await stage.remove(); }
	assert.equal(rows(raw).length, 1); assert.equal(rows(raw)[0]!.token, OTHER);
	assert.equal(new TextDecoder().decode(rows(raw)[0]!.bytes!), 'foreign');
	await stage.remove(); assert.equal(rows(raw).length, 1, 'repeat removal cannot touch another key');
});

test('close waits for native commit and read waits for its own readonly completion', async () => {
	const raw = createInstrumentedIndexedDB(); let database!: IDBDatabase;
	const stage = await createIndexedDbDebugOutputCurrentV1(factoryFor(raw, value => { database = value; }), TOKEN);
	const writer = await stage.createWritable(); await writer.write(Uint8Array.of(4, 2));
	const observed = observeBuffers(database);
	const commit = holdCompletion(database, 'readwrite'), closing = writer.close();
	try {
		await commit.entered.promise; assert.equal(await remainsPending(closing), true);
		await assert.rejects(writer.close(), /closed|failed/u);
		assert.deepEqual(new Uint8Array(observed.written[0]!), Uint8Array.of(4, 2), 'the actual submitted bytes remain intact until native completion');
		await assert.rejects(stage.read(), /committed/u);
		commit.release.resolve(); await closing; assert.equal(new Uint8Array(observed.written[0]!).every(value => value === 0), true);
	} finally { commit.release.resolve(); await closing; commit.restore(); }
	const reading = holdCompletion(database, 'readonly'), work = stage.read();
	try {
		await reading.entered.promise; assert.equal(await remainsPending(work), true);
		reading.release.resolve(); assert.deepEqual(new Uint8Array(await (await work).arrayBuffer()), Uint8Array.of(4, 2));
	} finally { reading.release.resolve(); await work; reading.restore(); await stage.remove(); }
});

test('abort joins an in-flight commit and deletes only its token before reporting completion', async () => {
	const raw = createInstrumentedIndexedDB(); let database!: IDBDatabase;
	const stage = await createIndexedDbDebugOutputCurrentV1(factoryFor(raw, value => { database = value; }), TOKEN);
	raw.seedRecord(NAME, 'outputs', { token: OTHER, bytes: new TextEncoder().encode('keep').buffer });
	const writer = await stage.createWritable(); await writer.write(Uint8Array.of(7));
	const held = holdCompletion(database, 'readwrite'), closing = writer.close(), aborting = writer.abort();
	try {
		await held.entered.promise; assert.equal(await remainsPending(aborting), true);
		held.release.resolve(); await closing; await aborting;
		assert.deepEqual(rows(raw).map(row => row.token), [OTHER]);
		await assert.rejects(writer.write(Uint8Array.of(8)), /closed|retir/u);
		await assert.rejects(stage.read(), /retir/u); assert.equal(raw.stats.activeTransactions, 0);
	} finally { held.release.resolve(); await Promise.allSettled([closing, aborting]); held.restore(); await stage.remove(); }
});

test('the eight MiB bound refuses excess bytes and abort retires uncommitted buffered output', async () => {
	const raw = createInstrumentedIndexedDB(), stage = await createIndexedDbDebugOutputCurrentV1(raw as unknown as IDBFactory, TOKEN);
	const writer = await stage.createWritable(), input = new Uint8Array(LIMIT); input[0] = 19;
	try {
		await writer.write(input); await assert.rejects(writer.write(Uint8Array.of(1)), /eight MiB/u);
		await assert.rejects(writer.close(), /closed|failed/u);
		await writer.abort(); assert.deepEqual(rows(raw), []); assert.equal(input[0], 19);
	} finally { await stage.remove(); }
});

test('failed native put remains a failure and cannot be read back as a committed output', async () => {
	const raw = createInstrumentedIndexedDB(), stage = await createIndexedDbDebugOutputCurrentV1(raw as unknown as IDBFactory, TOKEN);
	const writer = await stage.createWritable(), failure = new DOMException('diagnostic quota refused', 'QuotaExceededError');
	await writer.write(Uint8Array.of(1)); raw.failNextPutForStore('outputs', failure);
	try {
		await assert.rejects(writer.close(), error => error === failure);
		await assert.rejects(stage.read(), /committed/u);
		assert.equal(rows(raw)[0]!.bytes, null); assert.equal(raw.stats.activeTransactions, 0);
	} finally { await stage.remove(); }
	assert.deepEqual(rows(raw), []);
});

test('removal failure keeps its connection and entry; a successful retry verifies absence before closing', async () => {
	const raw = createInstrumentedIndexedDB(); let closes = 0;
	const stage = await createIndexedDbDebugOutputCurrentV1(factoryFor(raw, database => { database.close = () => { closes++; }; }), TOKEN);
	const failure = new Error('diagnostic deletion refused'); raw.failNextDeleteForStore('outputs', failure);
	await assert.rejects(stage.remove(), error => error === failure);
	assert.equal(closes, 0); assert.equal(rows(raw).length, 1);
	await stage.remove(); assert.deepEqual(rows(raw), []); assert.equal(closes, 1);
});

test('removal joins the fresh absence-verification transaction before closing the connection', async () => {
	const raw = createInstrumentedIndexedDB(); let database!: IDBDatabase, closes = 0;
	const stage = await createIndexedDbDebugOutputCurrentV1(factoryFor(raw, value => { database = value; database.close = () => { closes++; }; }), TOKEN);
	const held = holdCompletion(database, 'readonly'), removing = stage.remove();
	try {
		await held.entered.promise; assert.equal(await remainsPending(removing), true); assert.equal(closes, 0);
		held.release.resolve(); await removing; assert.equal(closes, 1); assert.deepEqual(rows(raw), []);
	} finally { held.release.resolve(); await removing; held.restore(); }
});

test('a token observed after deletion refuses cleanup completion and keeps its handle', async () => {
	const raw = createInstrumentedIndexedDB(); let closes = 0;
	const stage = await createIndexedDbDebugOutputCurrentV1(factoryFor(raw, database => { database.close = () => { closes++; }; }), TOKEN);
	raw.onNextGetForStore('outputs', () => { raw.seedRecord(NAME, 'outputs', { token: TOKEN, bytes: null }); });
	await assert.rejects(stage.remove(), /remains after deletion/u); assert.equal(closes, 0);
	await stage.remove(); assert.deepEqual(rows(raw), []); assert.equal(closes, 1);
});

test('a reserved token collision refuses creation without replacing existing output', async () => {
	const raw = createInstrumentedIndexedDB(), stage = await createIndexedDbDebugOutputCurrentV1(raw as unknown as IDBFactory, TOKEN);
	try {
		await assert.rejects(createIndexedDbDebugOutputCurrentV1(raw as unknown as IDBFactory, TOKEN), /already contains/u);
		assert.deepEqual(rows(raw), [{ token: TOKEN, bytes: null }]);
	} finally { await stage.remove(); }
});

test('blocked open rejects and closes a connection delivered by a late native success', async () => {
	let opening!: IDBOpenDBRequest, closes = 0;
	const factory = { open() { opening = {} as IDBOpenDBRequest; return opening; } } as unknown as IDBFactory;
	const work = createIndexedDbDebugOutputCurrentV1(factory, TOKEN);
	opening.onblocked?.call(opening, {} as IDBVersionChangeEvent);
	await assert.rejects(work, error => {
		assert.equal(isDebugCleanupFailureCurrentV1(error), true); assert.ok(error instanceof AggregateError);
		assert.match((error.errors[0] as Error).message, /blocked/u); return true;
	});
	Object.defineProperty(opening, 'result', { value: { close() { closes++; } } });
	opening.onsuccess?.call(opening, {} as Event); assert.equal(closes, 1);
});

test('a blocked open retains a late native close failure on its original cleanup error', async () => {
	let opening!: IDBOpenDBRequest, failure!: AggregateError;
	const factory = { open() { opening = {} as IDBOpenDBRequest; return opening; } } as unknown as IDBFactory;
	const work = createIndexedDbDebugOutputCurrentV1(factory, TOKEN), closeFailure = new Error('late handle close refused');
	opening.onblocked?.call(opening, {} as IDBVersionChangeEvent);
	await assert.rejects(work, error => { assert.ok(error instanceof AggregateError); failure = error; return true; });
	Object.defineProperty(opening, 'result', { value: { close() { throw closeFailure; } } });
	assert.doesNotThrow(() => opening.onsuccess?.call(opening, {} as Event));
	assert.equal(failure.errors.at(-1), closeFailure);
});

test('native open errors remain the primary failure', async () => {
	let opening!: IDBOpenDBRequest;
	const factory = { open() { opening = {} as IDBOpenDBRequest; return opening; } } as unknown as IDBFactory;
	const failure = new Error('diagnostic open refused'), work = createIndexedDbDebugOutputCurrentV1(factory, TOKEN);
	Object.defineProperty(opening, 'error', { value: failure }); opening.onerror?.call(opening, {} as Event);
	await assert.rejects(work, error => error === failure);
});

test('versionchange closes the handle and refuses further output and false cleanup success', async () => {
	const raw = createInstrumentedIndexedDB(); let database!: IDBDatabase, closes = 0;
	const stage = await createIndexedDbDebugOutputCurrentV1(factoryFor(raw, value => { database = value; database.close = () => { closes++; }; }), TOKEN);
	database.onversionchange?.call(database, {} as IDBVersionChangeEvent); assert.equal(closes, 1);
	await assert.rejects(stage.createWritable(), /version/u);
	await assert.rejects(stage.remove(), /version/u); assert.equal(rows(raw).length, 1);
});

test('versionchange during reservation retains the actual unretired token and closed handle as cleanup failure', async () => {
	const raw = createInstrumentedIndexedDB(), ready = deferred<ReturnType<typeof holdCompletion>>();
	let database!: IDBDatabase, closed = false;
	const factory = factoryFor(raw, value => {
		database = value; const native = database.transaction.bind(database);
		database.close = () => { closed = true; };
		database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
			if (closed) throw new DOMException('Connection is closed.', 'InvalidStateError');
			return native(...args);
		}) as IDBDatabase['transaction'];
		ready.resolve(holdCompletion(database, 'readwrite'));
	});
	const opening = createIndexedDbDebugOutputCurrentV1(factory, TOKEN), held = await ready.promise;
	const rejected = assert.rejects(opening, error => {
		assert.equal(isDebugCleanupFailureCurrentV1(error), true);
		assert.ok(error instanceof AggregateError);
		assert.match((error.errors[0] as Error).message, /version/u); return true;
	});
	try {
		await held.entered.promise; database.onversionchange?.call(database, {} as IDBVersionChangeEvent);
		held.release.resolve(); await rejected; assert.equal(closed, true);
		assert.deepEqual(rows(raw), [{ token: TOKEN, bytes: null }]);
	} finally { held.release.resolve(); await rejected; held.restore(); }
});
