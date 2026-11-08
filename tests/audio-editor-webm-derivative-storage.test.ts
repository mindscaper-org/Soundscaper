/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES } from '../src/common/editor/video-preview-capture-admission.ts';
import { projectDerivativeCacheInventoryRecord } from '../src/common/editor/storage/derivative-cache-entry.ts';
import type { VideoDerivativeRepository } from '../src/common/editor/storage/video-derivative-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

interface IndexedDBFixture {
	open(name: string, version?: number): IDBOpenDBRequest;
	records(database: string, store: string): Record<string, unknown>[];
	seedRecord(database: string, store: string, value: unknown, primaryKey?: IDBValidKey): void;
	failNextPutForStore(store: string, error?: Error): void;
}
interface DerivativeStore extends Omit<ReturnType<typeof createProjectStore>, 'saveVideoDerivative' | 'loadVideoDerivative'> {
	saveVideoDerivative: VideoDerivativeRepository['saveDerivative'];
	loadVideoDerivative: VideoDerivativeRepository['loadDerivative'];
}
const PAYLOAD = Uint8Array.of(82, 73, 70, 70, 1, 2, 3, 4);
function poster(bytes: Uint8Array<ArrayBuffer> = PAYLOAD): Blob { return new Blob([bytes], { type: 'image/webp' }); }

for (const type of ['poster', 'thumbnail']) test(`a ${type} survives IndexedDB implementations that cannot clone Blob payloads`, async () => {
	const fixture = await storageFixture();
	try {
		const saved: unknown = await fixture.store.saveVideoDerivative('video', { type, timestamp: .4, blob: poster() });
		assertRecord(saved); assert.equal('encodedBytes' in saved, false); assert.equal('blob' in saved, false);
		assert.equal((await fixture.store.listVideoDerivatives('video')).length, 1);
		await fixture.store.close();
		const reopened = fixture.reopen();
		try {
			const loaded: unknown = await reopened.loadVideoDerivative('video', { type, timestamp: .4 });
			assert(loaded instanceof Blob); assert.equal(loaded.type, 'image/webp');
			assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), PAYLOAD);
		} finally { await reopened.close(); }
	} finally { await fixture.store.close(); }
});

test('typed derivative payload corruption still fails the exact size and SHA-256 fences', async () => {
	const fixture = await storageFixture();
	try {
		await fixture.store.saveVideoDerivative('video', { type: 'poster', blob: poster() });
		const [record] = fixture.rows(); assertRecord(record);
		assert(record.encodedBytes instanceof Uint8Array);
		fixture.seed({ ...record, encodedBytes: Uint8Array.of(1) });
		await assert.rejects(fixture.store.loadVideoDerivative('video', { type: 'poster' }), /size|payload/iu);
		fixture.seed({ ...record, encodedBytes: new Uint8Array(PAYLOAD.length).fill(9) });
		await assert.rejects(fixture.store.loadVideoDerivative('video', { type: 'poster' }), /digest integrity/iu);
		fixture.seed({ ...record, encodedBytes: PAYLOAD.buffer });
		await assert.rejects(fixture.store.loadVideoDerivative('video', { type: 'poster' }), /payload/iu);
	} finally { await fixture.store.close(); }
});

test('byte payload replacement and cache eviction retain their original transaction ownership', async () => {
	const fixture = await storageFixture();
	try {
		await fixture.store.saveVideoDerivative('video', { type: 'poster', blob: poster() });
		const [first] = fixture.rows(); assertRecord(first);
		const failure = new Error('Inventory write refused.');
		fixture.indexedDB.failNextPutForStore('videoDerivativeCacheEntries', failure);
		await assert.rejects(fixture.store.saveVideoDerivative('video', { type: 'poster', blob: poster(Uint8Array.of(9, 8)) }), (error: unknown) => Object.is(error, failure));
		assert.deepEqual(fixture.rows(), [first]);
		const loaded: unknown = await fixture.store.loadVideoDerivative('video', { type: 'poster' });
		assert(loaded instanceof Blob); assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), PAYLOAD);
		await fixture.store.saveVideoDerivative('video', { type: 'thumbnail', timestamp: 1, blob: poster() });
		const trimmed = await fixture.store.trimVideoDerivativeCache({ maximumEntries: 1, maximumBytes: 100 });
		assert.equal(trimmed.removedEntries, 1); assert.equal(fixture.rows().length, 1);
		assert.equal(fixture.indexedDB.records(fixture.name, 'videoDerivativeCacheEntries').length, 1);
	} finally { await fixture.store.close(); }
});

test('legacy Blob derivatives remain readable with the same immutable content binding', async () => {
	const fixture = await storageFixture();
	try {
		await fixture.store.saveVideoDerivative('video', { type: 'poster', blob: poster() });
		const [record] = fixture.rows(); assertRecord(record);
		const legacy: Record<string, unknown> = { ...record, storage: 'indexeddb-blob', blob: poster() }; delete legacy.encodedBytes;
		fixture.seed(legacy);
		assert.equal(typeof legacy.key, 'string');
		fixture.indexedDB.seedRecord(fixture.name, 'videoDerivativeCacheEntries', projectDerivativeCacheInventoryRecord(legacy, String(legacy.key)));
		const loaded: unknown = await fixture.store.loadVideoDerivative('video', { type: 'poster' });
		assert(loaded instanceof Blob); assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), PAYLOAD);
	} finally { await fixture.store.close(); }
});

test('the portable inline fallback admits the existing exact preview bound', async () => {
	const fixture = await storageFixture();
	try {
		const bytes = new Uint8Array(VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES); bytes[bytes.length - 1] = 77;
		await fixture.store.saveVideoDerivative('video', { type: 'poster', blob: poster(bytes) });
		const loaded: unknown = await fixture.store.loadVideoDerivative('video', { type: 'poster' });
		assert(loaded instanceof Blob); assert.equal(loaded.size, bytes.length);
		assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);
	} finally { await fixture.store.close(); }
});

test('larger legacy payloads retain their existing bounded-read Blob path', async () => {
	const fixture = await storageFixture({ rejectBlobs: false });
	const read = Blob.prototype.arrayBuffer, spans: number[] = [];
	try {
		Blob.prototype.arrayBuffer = function(this: Blob): Promise<ArrayBuffer> { spans.push(this.size); return read.call(this); };
		const bytes = new Uint8Array(VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES + 1);
		await fixture.store.saveVideoDerivative('video', { type: 'poster', blob: poster(bytes) });
		assert(spans.length > 0); assert(Math.max(...spans) <= VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES);
		assert.equal(fixture.rows()[0]?.storage, 'indexeddb-blob');
	} finally { Blob.prototype.arrayBuffer = read; await fixture.store.close(); }
});

async function storageFixture({ rejectBlobs = true } = {}) {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IndexedDBFixture;
	const name = `webm-poster-storage-${crypto.randomUUID()}`;
	const reopen = () => createProjectStore({ indexedDB, memoryFallback: false, preferOpfs: false, databaseName: name }) as unknown as DerivativeStore;
	const store = reopen(); await store.ready();
	await store.writeMediaAsset('video', new Blob(['immutable original video']));
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
	});
	const transaction = database.transaction.bind(database);
	database.transaction = (...args: Parameters<IDBDatabase['transaction']>) => {
		const active = transaction(...args), objectStore = active.objectStore.bind(active);
		active.objectStore = (name: string) => {
			const target = objectStore(name), put = target.put.bind(target);
			if (name === 'videoDerivatives') target.put = (value: unknown, key?: IDBValidKey) => {
				if (rejectBlobs && isRecord(value) && value.blob instanceof Blob) throw new DOMException('Error preparing Blob/File data to be stored in object store', 'UnknownError');
				return key === undefined ? put(value) : put(value, key);
			};
			return target;
		};
		return active;
	};
	return { store, indexedDB, name, reopen, rows: () => indexedDB.records(name, 'videoDerivatives'),
		seed: (value: unknown) => indexedDB.seedRecord(name, 'videoDerivatives', value) };
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function assertRecord(value: unknown): asserts value is Record<string, unknown> { assert(isRecord(value)); }
