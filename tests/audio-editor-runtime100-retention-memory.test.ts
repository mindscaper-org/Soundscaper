/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { VideoDerivativeRepository } from '../src/common/editor/storage/video-derivative-repository.ts';
import type { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';

void test('R11 memory pruning partitions source chunk keys once for all deleted generations', async t => {
	const databaseName = `runtime100-retention-${crypto.randomUUID()}`; const memory = getMemoryDatabase(databaseName);
	const store = createProjectStore({ indexedDB: null, memoryFallback: true, preferOpfs: false, databaseName });
	await store.ready();
	for (let i = 0; i < 40; i++) {
		memory.sources.set(`s${i}`, { id: `s${i}`, sourceToken: `token${i}`, storage: 'indexeddb-chunks', committedAt: '2020-01-01T00:00:00.000Z' });
		for (let c = 0; c < 20; c++) memory.sourceChunks.set(`s${i}:${c}`, { sourceToken: `token${i}`, channels: [new Float32Array(1)] });
	}
	memory.sources.set('keep', { id: 'keep', sourceToken: 'keep-token', committedAt: '2020-01-01T00:00:00.000Z' }); memory.sourceChunks.set('keep:0', { sourceToken: 'keep-token', channels: [Float32Array.of(0.5)] });
	let visits = 0; const original = memory.sourceChunks[Symbol.iterator].bind(memory.sourceChunks);
	memory.sourceChunks[Symbol.iterator] = function* (): Generator<[string, unknown], undefined, unknown> { for (const entry of original()) { visits++; yield entry; } return undefined; };
	try { const result = await store.pruneUnreferencedSources({ protectedSourceIds: ['keep'], minimumAgeMs: 0 }); assert.equal(result.deletedSourceIds.length, 40); assert.deepEqual([...memory.sourceChunks.keys()], ['keep:0']); t.diagnostic(`chunk iterator visits ${visits}`); assert.ok(visits <= 801); }
	finally { delete (memory.sourceChunks as Partial<Map<string, unknown>>)[Symbol.iterator]; await store.close(); }
});

void test('R12 temporary asset cleanup inventories paths/tokens without cloning encoded payload bytes', async t => {
	const databaseName = `runtime100-cleanup-${crypto.randomUUID()}`; const memory = getMemoryDatabase(databaseName);
	const store = createProjectStore({ indexedDB: null, memoryFallback: true, preferOpfs: false, databaseName }); await store.ready();
	for (let i = 0; i < 10; i++) memory.mediaAssets.set(`a${i}`, { sourceId: `a${i}`, path: `a${i}.bin`, mediaChunkToken: `token${i}`, encodedBytes: new Uint8Array(65_536), storage: 'indexeddb-bytes' });
	let clonedBytes = 0; const original = globalThis.structuredClone;
	globalThis.structuredClone = function<T>(value: T, options?: StructuredSerializeOptions): T { if (value && typeof value === 'object' && 'encodedBytes' in value && value.encodedBytes instanceof Uint8Array) clonedBytes += value.encodedBytes.byteLength; return original(value, options); };
	try { await store.cleanupTemporaryAssets({ maximumAgeMs: 0 }); assert.equal(memory.mediaAssets.size, 10); t.diagnostic(`encoded payload clone bytes ${clonedBytes}`); assert.equal(clonedBytes, 0); }
	finally { globalThis.structuredClone = original; await store.close(); }
});

function repositories() {
	const memory = getMemoryDatabase(`runtime100-inventory-${crypto.randomUUID()}`); const removed: unknown[] = [];
	const opfs = { async deleteBinaryRecords(records: readonly unknown[]) { removed.push(...records); } } as unknown as OpfsRepository;
	const port = { memory, async database() { return null; } };
	return { memory, removed, media: new MediaRepository(port, opfs), sources: new SourceRecordRepository(port), derivatives: new VideoDerivativeRepository(port, opfs) };
}
function countInventoryMaps<T>(operation: () => Promise<T>) {
	let visits = 0; const original = Array.prototype.map;
	Array.prototype.map = function<Value, Result>(this: Value[], callback: (value: Value, index: number, array: Value[]) => Result, thisArg?: unknown): Result[] { if (this.length === 500) visits += this.length; return original.call(this, callback, thisArg) as Result[]; };
	return operation().then(result => ({ result, visits })).finally(() => { Array.prototype.map = original; });
}
void test('R13 memory derivative record queries materialize only selected clones', async t => {
	const { memory, derivatives } = repositories();
	for (let i = 0; i < 500; i++) memory.videoDerivatives.set(`d${i}`, { key: `d${i}`, sourceId: i === 499 ? 'target' : 'other', type: 'poster', custom: { value: i } });
	const { result, visits } = await countInventoryMaps(() => derivatives.derivativeRecords('target', 'poster'));
	assert.equal(result.length, 1); assert.equal(result[0]?.key, 'd499'); (result[0]!.custom as { value: number }).value = -1; assert.equal((memory.videoDerivatives.get('d499') as { custom: { value: number } }).custom.value, 499);
	t.diagnostic(`full inventory map visits ${visits}`); assert.equal(visits, 0);
});
void test('R14 memory derivative deletion materializes only selected disposal records', async t => {
	const { memory, derivatives, removed } = repositories();
	for (let i = 0; i < 500; i++) memory.videoDerivatives.set(`d${i}`, { key: `d${i}`, sourceId: i === 499 ? 'target' : 'other', type: 'poster', timestamp: i });
	const { visits } = await countInventoryMaps(() => derivatives.deleteDerivative('target', { type: 'poster' }));
	assert.equal(memory.videoDerivatives.size, 499); assert.equal(removed.length, 1); assert.equal(memory.videoDerivatives.has('d499'), false);
	t.diagnostic(`full deletion inventory map visits ${visits}`); assert.equal(visits, 0);
});
void test('R15 source metadata inventory retains full clones without an intermediate snapshot array', async t => {
	const { memory, sources } = repositories();
	for (let i = 0; i < 500; i++) memory.sources.set(`a${i}`, { id: `a${i}`, encodedBytes: Uint8Array.of(i % 256), custom: { value: i } });
	const { result, visits } = await countInventoryMaps(() => sources.list());
	assert.equal(result.length, 500); assert.equal((result[499]?.encodedBytes as Uint8Array)[0], 499 % 256); (result[0]?.encodedBytes as Uint8Array)[0] = 255;
	assert.equal(((memory.sources.get('a0') as { encodedBytes: Uint8Array }).encodedBytes)[0], 0);
	t.diagnostic(`source inventory map visits ${visits}`); assert.equal(visits, 0);
});

void test('source metadata list snapshots inventory membership before invoking clone getters', async () => {
	const { memory, sources } = repositories();
	memory.sources.set('first', { id: 'first', get name() { memory.sources.set('late', { id: 'late' }); return 'First'; } });
	memory.sources.set('second', { id: 'second', name: 'Second' });
	assert.deepEqual((await sources.list()).map(record => record.id), ['first', 'second']);
	assert.equal(memory.sources.has('late'), true);
});
