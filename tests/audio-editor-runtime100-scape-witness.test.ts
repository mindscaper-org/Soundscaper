/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import {
	createScapeArchiveLayoutWitness,
	SCAPE_MAXIMUM_STRUCTURAL_WITNESS_BYTES,
} from '../src/common/editor/scape-archive-layout-witness.ts';

void test('R05 adjacent archive header witnesses cluster without a replacement active array per probe', async t => {
	const bytes = Uint8Array.from({ length: 4_000 }, (_, index) => index % 251);
	const expected = bytes.slice();
	let sourceReads = 0;
	const source = createScapeArchiveByteSource({ size: bytes.length, read({ offset, length }) { sourceReads++; return bytes.subarray(offset, offset + length); } });
	const witness = createScapeArchiveLayoutWitness(source);
	for (let offset = 0; offset < bytes.length; offset += 4) witness.record(offset, bytes.subarray(offset, offset + 4));
	let filters = 0;
	const original = Array.prototype.filter;
	Array.prototype.filter = function<Value>(this: Value[], predicate: (value: Value, index: number, array: Value[]) => unknown, thisArg?: unknown) {
		filters++;
		return original.call(this, predicate, thisArg) as Value[];
	};
	let bound: ReturnType<typeof witness.bind>;
	try { bound = witness.bind(); } finally { Array.prototype.filter = original; }
	t.diagnostic(`active-array filter calls ${filters} for 1000 adjacent 4-byte witnesses`);
	assert.equal(filters, 0);
	bytes.fill(255);
	const first = await bound.read({ offset: 0, length: bytes.length });
	assert.deepEqual(first, expected);
	first[0] = 255;
	assert.deepEqual(await bound.read({ offset: 0, length: 4 }), expected.subarray(0, 4));
	assert.equal(sourceReads, 0, 'recorded windows retain their admitted bytes and require no live source reads');
});

void test('witness clustering preserves unsorted aliases, nested overlaps and fresh gap bytes', async () => {
	const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
	const original = bytes.slice();
	const reads: { offset: number; length: number }[] = [];
	const source = createScapeArchiveByteSource({ size: bytes.length, read({ offset, length }) { reads.push({ offset, length }); return bytes.subarray(offset, offset + length); } });
	const witness = createScapeArchiveLayoutWitness(source);
	for (const [offset, end] of [[10, 12], [4, 6], [2, 4], [3, 5], [0, 8], [0, 8], [24, 28], [24, 26]] as const) {
		const probe = bytes.slice(offset, end);
		witness.record(offset, probe);
		probe.fill(255);
	}
	const bound = witness.bind();
	bytes.fill(200);
	const expected = bytes.slice();
	for (const [offset, end] of [[0, 8], [10, 12], [24, 28]] as const) expected.set(original.subarray(offset, end), offset);
	assert.deepEqual(await bound.read({ offset: 0, length: bytes.length }), expected);
	assert.deepEqual(reads, [{ offset: 8, length: 2 }, { offset: 12, length: 12 }, { offset: 28, length: 4 }]);
	assert.throws(() => witness.record(0, Uint8Array.of(0)), /already bound/u);
	assert.throws(() => witness.bind(), /already bound/u);
});

void test('witness clustering rejects conflicting retained overlap and keeps failed binding closed', () => {
	const source = createScapeArchiveByteSource({ size: 32, read: ({ length }) => new Uint8Array(length) });
	const witness = createScapeArchiveLayoutWitness(source);
	witness.record(8, Uint8Array.of(8, 9, 10, 11));
	witness.record(0, Uint8Array.from({ length: 16 }, (_, index) => index));
	witness.record(2, Uint8Array.of(2, 99));
	assert.throws(() => witness.bind(), /changed during structural validation/u);
	assert.throws(() => witness.bind(), /already bound/u);
	assert.throws(() => witness.record(0, Uint8Array.of(0)), /already bound/u);
});

void test('witness bounds preserve empty ranges, source read limits and cancellation', async () => {
	let sourceReads = 0;
	const source = createScapeArchiveByteSource({ size: 16, maximumReadBytes: 8, read({ length }) { sourceReads++; return new Uint8Array(length).fill(7); } });
	const witness = createScapeArchiveLayoutWitness(source);
	for (const offset of [-1, 17, Number.NaN, Number.MAX_SAFE_INTEGER]) assert.throws(() => witness.record(offset, new Uint8Array()), /invalid byte range/u);
	assert.throws(() => witness.record(16, Uint8Array.of(1)), /invalid byte range/u);
	witness.record(16, new Uint8Array());
	witness.record(0, Uint8Array.of(0, 1, 2, 3));
	const bound = witness.bind();
	assert.equal(bound.size, 16); assert.equal(bound.maximumReadBytes, 8);
	assert.deepEqual(await bound.read({ offset: 0, length: 8 }), Uint8Array.of(0, 1, 2, 3, 7, 7, 7, 7));
	assert.equal(sourceReads, 1);
	await assert.rejects(bound.read({ offset: 0, length: 9 }), /unbounded byte range/u);
	const abort = new AbortController(); abort.abort();
	await assert.rejects(bound.read({ offset: 8, length: 4, signal: abort.signal }), { name: 'AbortError' });
	assert.equal(sourceReads, 1);
});

void test('witness retained byte admission enforces the aggregate portable limit before copying another probe', () => {
	const source = createScapeArchiveByteSource({ size: SCAPE_MAXIMUM_STRUCTURAL_WITNESS_BYTES + 1, read: ({ length }) => new Uint8Array(length) });
	const witness = createScapeArchiveLayoutWitness(source);
	const bytes = new Uint8Array(SCAPE_MAXIMUM_STRUCTURAL_WITNESS_BYTES);
	witness.record(0, bytes);
	assert.throws(() => witness.record(0, Uint8Array.of(1)), /portable byte limit/u);
	assert.throws(() => witness.record(source.size, Uint8Array.of(1)), /invalid byte range/u);
});
