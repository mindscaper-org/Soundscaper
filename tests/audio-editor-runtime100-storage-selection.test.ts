/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { SourceDeletionRepository } from '../src/common/editor/storage/source-deletion-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import type { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';

function repositories() {
	const memory = getMemoryDatabase(`runtime100-selection-${crypto.randomUUID()}`); const removed: unknown[] = [];
	const opfs = { async deleteBinaryRecords(records: readonly unknown[]) { removed.push(...records); } } as unknown as OpfsRepository;
	const port = { memory, async database() { return null; } };
	return { memory, removed, media: new MediaRepository(port, opfs), deletion: new SourceDeletionRepository(port), records: new SourceRecordRepository(port) };
}
async function inventoryWork<T>(operation: () => Promise<T>) {
	let visits = 0; const original = Array.prototype.map;
	Array.prototype.map = function<Value, Result>(this: Value[], callback: (value: Value, index: number, array: Value[]) => Result, thisArg?: unknown): Result[] { if (this.length === 500) visits += this.length; return original.call(this, callback, thisArg) as Result[]; };
	try { return { result: await operation(), visits }; } finally { Array.prototype.map = original; }
}
void test('R18 deleting an original media asset selects only related derivative disposal records', async t => {
	const { memory, media, removed } = repositories(); memory.mediaAssets.set('target', { sourceId: 'target', path: 'original.bin' });
	for (let i = 0; i < 500; i++) memory.videoDerivatives.set(`d${i}`, { key: `d${i}`, sourceId: i === 499 ? 'target' : 'other', custom: { value: i } });
	const { visits } = await inventoryWork(() => media.deleteAsset('target'));
	assert.equal(memory.videoDerivatives.size, 499); assert.equal(memory.mediaAssets.size, 0); assert.equal(removed.length, 2);
	t.diagnostic(`original deletion inventory map visits ${visits}`); assert.equal(visits, 0);
	const invalid = repositories(); invalid.memory.mediaAssets.set('target', { sourceId: 'target' }); invalid.memory.videoDerivatives.set('bad', { key: 'bad', sourceId: 'target', callback() {} });
	await assert.rejects(invalid.media.deleteAsset('target')); assert.equal(invalid.memory.mediaAssets.has('target'), true); assert.equal(invalid.memory.videoDerivatives.has('bad'), true);
});
void test('R19 source generation detachment compacts one derivative membership snapshot', async t => {
	const { memory, deletion } = repositories(); memory.sources.set('target', { id: 'target', sourceToken: 'token' }); memory.sourceChunks.set('c', { sourceToken: 'token' });
	const selected = { key: 'd499', sourceId: 'target', custom: { value: 499 } };
	for (let i = 0; i < 499; i++) memory.videoDerivatives.set(`d${i}`, { key: `d${i}`, sourceId: 'other' }); memory.videoDerivatives.set('d499', selected);
	const { result, visits } = await inventoryWork(() => deletion.detachIfUnreferenced('target'));
	assert.equal(result.status, 'detached'); if (result.status !== 'detached') throw new Error('Fixture source unexpectedly retained.');
	assert.equal(result.derivatives.length, 1); (result.derivatives[0]?.custom as { value: number }).value = 0; assert.equal(selected.custom.value, 499); assert.equal(memory.sourceChunks.size, 0); assert.equal(memory.videoDerivatives.size, 499);
	t.diagnostic(`source detachment inventory map visits ${visits}`); assert.equal(visits, 0);
	const invalid = repositories(); invalid.memory.sources.set('target', { id: 'target' }); invalid.memory.videoDerivatives.set('bad', { key: 'bad', sourceId: 'target', callback() {} });
	await assert.rejects(invalid.deletion.detachIfUnreferenced('target')); assert.equal(invalid.memory.sources.has('target'), false); assert.equal(invalid.memory.videoDerivatives.has('bad'), false);
});
void test('R20 memory chunk streams compact one membership snapshot and retain stable index order', async t => {
	const { memory, records } = repositories();
	for (let i = 0; i < 497; i++) memory.sourceChunks.set(`other${i}`, { key: `other${i}`, sourceToken: 'other', index: i, channels: [Float32Array.of(1)] });
	for (const [key, index] of [['late', 8], ['first', 3], ['second', 3]] as const) memory.sourceChunks.set(key, { key, sourceToken: 'target', index, channels: [Float32Array.of(index)] });
	const { result, visits } = await inventoryWork(async () => { const iterator = records.chunks('target'); const first = await iterator.next(); assert.equal(first.value?.key, 'first'); memory.sourceChunks.set('new', { key: 'new', sourceToken: 'target', index: 0 }); const rest = []; for await (const record of iterator) rest.push(record); return [first.value, ...rest]; });
	assert.deepEqual(result.map(record => record?.key), ['first', 'second', 'late']); const channels = result[0]?.channels as Float32Array[]; channels[0]![0] = -1; assert.equal(((memory.sourceChunks.get('first') as { channels: Float32Array[] }).channels[0]![0]), 3);
	t.diagnostic(`full chunk inventory map visits ${visits}`); assert.equal(visits, 0);
});
