/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readLightscaperSmokeOriginalBodyCurrentV1, openLightscaperSmokeExistingDatabaseCurrentV1,
	readLightscaperSmokeChunkBodyCurrentV1 } from '../desktop/lightscaper-managed-smoke-custody-current-v1.ts';

const bytes = new Uint8Array([1, 2, 3, 4]);
const fixture = { name: 'owned.dng', mimeType: 'image/x-adobe-dng', base64: 'AQIDBA==', byteLength: 4,
	sha256: createHash('sha256').update(bytes).digest('hex') };
const original = { storageKey: 'owned-original', byteLength: 4, contentSha256: fixture.sha256, retention: 'managed' };

test('Lightscaper smoke reads only the recorded OPFS body with create:false and authenticates actual bytes', async () => {
	const calls: unknown[] = [];
	const directory = { async getDirectoryHandle(name: string, options: unknown) { calls.push(['directory', name, options]); return {
		async getFileHandle(path: string, options: unknown) { calls.push(['file', path, options]); return { async getFile() { return new Blob([bytes]); } }; },
	}; } } as unknown as FileSystemDirectoryHandle;
	const actual = await readLightscaperSmokeOriginalBodyCurrentV1({ sourceId: 'owned-original', size: 4, sha256: fixture.sha256,
		storage: 'opfs', path: 'owned.blob' }, original, fixture, async () => directory);
	assert.deepEqual(actual, { byteLength: 4, sha256: fixture.sha256, storage: 'opfs' });
	assert.deepEqual(calls, [['directory', 'lightscaper-photo-originals', { create: false }], ['file', 'owned.blob', { create: false }]]);
});

test('Lightscaper smoke rejects corrupt bodies, unsafe paths and mismatched media identity without fallback', async () => {
	const metadata = { sourceId: 'owned-original', size: 4, sha256: fixture.sha256, storage: 'indexeddb-blob', blob: new Blob([bytes]) };
	assert.deepEqual(await readLightscaperSmokeOriginalBodyCurrentV1(metadata, original, fixture),
		{ byteLength: 4, sha256: fixture.sha256, storage: 'indexeddb-blob' });
	for (const patch of [{ sha256: '0'.repeat(64) }, { sourceId: 'foreign' }, { size: 3 }, { blob: new Blob([new Uint8Array(4)]) },
		{ storage: 'opfs', path: '../owned.blob' }, { storage: 'opfs', path: 'nested/owned.blob' }, { storage: 'unknown' }]) {
		await assert.rejects(readLightscaperSmokeOriginalBodyCurrentV1({ ...metadata, ...patch }, original, fixture,
			() => Promise.reject(new Error('Unsafe identity reached OPFS.'))));
	}
});

test('Lightscaper smoke never initializes a missing native database', async () => {
	let aborted = false;
	const pending = { transaction: { abort() { aborted = true; queueMicrotask(() => pending.onerror?.()); } },
		error: new Error('Upgrade aborted'), onupgradeneeded: null as (() => void) | null,
		onerror: null as (() => void) | null, onsuccess: null as (() => void) | null };
	const factory = { open(name: string, version?: number) {
		assert.equal(name, 'lightscaper-absent'); assert.equal(version, undefined);
		queueMicrotask(() => pending.onupgradeneeded?.()); return pending;
	} } as unknown as IDBFactory;
	await assert.rejects(openLightscaperSmokeExistingDatabaseCurrentV1(factory, 'lightscaper-absent'));
	assert.equal(aborted, true);
});

test('Lightscaper smoke closes a late database open after a blocked refusal', async () => {
	let closed = 0;
	const request = { result: { close() { closed++; } }, onblocked: null as (() => void) | null, onsuccess: null as (() => void) | null };
	const factory = { open: () => request } as unknown as IDBFactory;
	const opening = openLightscaperSmokeExistingDatabaseCurrentV1(factory, 'lightscaper-blocked');
	request.onblocked?.(); await assert.rejects(opening, /blocked/u);
	request.onsuccess?.(); assert.equal(closed, 1);
});

test('Lightscaper smoke authenticates the complete native restored chunk inventory and rejects altered ownership', async () => {
	const metadata = { sourceId: original.storageKey, size: 4, mediaChunkToken: 'owned-token', mediaChunkCount: 1, mediaChunkBytes: 4 * 1024 ** 2 };
	const chunk = { key: 'owned-token:0000000000', sourceId: original.storageKey, mediaChunkToken: 'owned-token', index: 0,
		byteLength: 4, createdAt: 1, payloadEncoding: 'array-buffer-v1', payloadBytes: bytes.slice().buffer };
	const ports = { count: async (token: string) => { assert.equal(token, 'owned-token'); return 1; },
		read: async (key: string): Promise<unknown> => { assert.equal(key, chunk.key); return chunk; } };
	assert.deepEqual(new Uint8Array(await (await readLightscaperSmokeChunkBodyCurrentV1(metadata, ports)).arrayBuffer()), bytes);
	for (const patch of [{ key: 'foreign' }, { sourceId: 'foreign' }, { mediaChunkToken: 'foreign' }, { index: 1 }, { byteLength: 3 }, { payloadBytes: bytes.slice(0, 3).buffer }]) {
		await assert.rejects(readLightscaperSmokeChunkBodyCurrentV1(metadata, { ...ports, read: async () => ({ ...chunk, ...patch }) }));
	}
	await assert.rejects(readLightscaperSmokeChunkBodyCurrentV1(metadata, { ...ports, count: async () => 2 }));
	await assert.rejects(readLightscaperSmokeChunkBodyCurrentV1({ ...metadata, mediaChunkCount: 2 }, ports));
});
