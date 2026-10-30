/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDigest, digestBytes, bytesStream, hashingStream, hex } from '../src/common/media/bytes.ts';
import { request, transact, MAX_INDEXEDDB_CURSOR_PAGE_SIZE } from '../src/common/media/indexeddb.ts';

void test('media byte streams snapshot their input and hash the exact streamed bytes', async () => {
	const input = new Uint8Array([97, 98, 99]);
	const stream = bytesStream(input);
	input.fill(0);
	const digest = createDigest();
	const actual = new Uint8Array(await new Response(hashingStream(stream, digest)).arrayBuffer());
	assert.deepEqual(actual, new Uint8Array([97, 98, 99]));
	assert.equal(hex(digest.digest()), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	assert.equal(digestBytes(actual), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

void test('media hashing preserves cancellation and rejects non-byte chunks', async () => {
	const controller = new AbortController();
	const reason = new Error('cancelled media read');
	controller.abort(reason);
	await assert.rejects(new Response(hashingStream(bytesStream(new Uint8Array([1])), createDigest(), controller.signal)).arrayBuffer(), error => error === reason);
	const invalid = new ReadableStream<Uint8Array>({ start(output) { output.enqueue('invalid' as unknown as Uint8Array); output.close(); } });
	await assert.rejects(new Response(hashingStream(invalid, createDigest())).arrayBuffer(), /non-byte chunk/u);
});

void test('generic IndexedDB requests preserve provider errors', async () => {
	const pending = {} as IDBRequest<number>;
	const result = request(pending);
	Object.defineProperty(pending, 'result', { value: 42 });
	pending.onsuccess?.call(pending, {} as Event);
	assert.equal(await result, 42);
	const failed = {} as IDBRequest<unknown>;
	const failure = new DOMException('blocked', 'UnknownError');
	Object.defineProperty(failed, 'error', { value: failure });
	const rejected = request(failed);
	failed.onerror?.call(failed, {} as Event);
	await assert.rejects(rejected, error => error === failure);
});

void test('generic transactions await commit and preserve an operation failure on abort', async () => {
	let aborted = false;
	const transaction = { objectStore: () => ({}), abort() { aborted = true; transaction.onabort?.(); }, oncomplete: undefined as (() => void) | undefined, onabort: undefined as (() => void) | undefined };
	const database = { transaction: () => transaction } as unknown as IDBDatabase;
	let settled = false;
	const result = transact(database, ['records'], 'readwrite', () => 42).then(value => { settled = true; return value; });
	await Promise.resolve();
	assert.equal(settled, false);
	transaction.oncomplete?.();
	assert.equal(await result, 42);
	const failure = new Error('operation failed');
	await assert.rejects(transact(database, 'records', 'readwrite', () => { throw failure; }), error => error === failure);
	assert.equal(aborted, true);
	assert.equal(MAX_INDEXEDDB_CURSOR_PAGE_SIZE, 64);
});
