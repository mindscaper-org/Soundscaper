/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { digestMediaContent, type MediaContentDigestBlob } from '../src/common/media/content-digest.ts';
import { readCursorPage } from '../src/common/media/indexeddb.ts';

test('content hashing refuses incomplete blob providers and preserves read failures', async () => {
	const failure = new Error('The retained media could not be read');
	for (const [blob, error] of [
		[{ size: 1 }, /provide Blob.slice/u],
		[{ size: 1, slice: () => ({}) }, /provide arrayBuffer/u],
		[{ size: 1, slice: () => ({ arrayBuffer: () => Promise.reject(failure) }) }, failure],
		[{ size: 1, slice: () => ({ arrayBuffer: () => Promise.resolve(new Uint8Array(1)) }) }, /return an ArrayBuffer/u],
	] as const) {
		await assert.rejects(digestMediaContent(blob as unknown as MediaContentDigestBlob), error);
	}
});

test('cursor pages reject a failed request instead of returning a partial page', async () => {
	const pending = {} as IDBRequest<IDBCursorWithValue | null>;
	const source = { openCursor: () => pending } as unknown as IDBObjectStore;
	const reading = readCursorPage(source);
	pending.onerror?.call(pending, new Event('error'));
	await assert.rejects(reading, /Could not enumerate IndexedDB/u);
});

test('a cursor continuation failure retains its cause and does not publish the page', async () => {
	const failure = new Error('The cursor transaction became inactive');
	const pending = { result: { primaryKey: 'a', key: 'index', continuePrimaryKey() { throw failure; } } } as unknown as IDBRequest<IDBCursorWithValue | null>;
	const source = { openCursor: () => pending } as unknown as IDBIndex;
	const reading = readCursorPage(source, { query: 'index', afterPrimaryKey: 'z' });
	pending.onsuccess?.call(pending, new Event('success'));
	await assert.rejects(reading, error => error === failure);
});
