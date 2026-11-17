/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyScapeReopenAssets } from '../src/common/editor/scape-project-reopen-assets.ts';
import { ScapeExpandedByteBudget } from '../src/common/scape/expanded-byte-budget.ts';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../src/common/scape/archive-envelope.ts';

function asset(name: string, bytes: Uint8Array) {
	const descriptor: ScapeAssetDescriptor = { sourceId: name, kind: 'video', encoding: 'video-original-v1', entry: name,
		size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
	const entry: ScapeArchiveEntry = { filename: name, directory: false, encrypted: false, compressionMethod: 0,
		compressedSize: bytes.length, uncompressedSize: bytes.length,
		async getData(stream) { const writer = stream.getWriter(); try { await writer.write(bytes); await writer.close(); } finally { writer.releaseLock(); } },
	};
	return { descriptor, entry };
}

test('unchanged archive media is streamed through digest and cumulative expansion checks', async () => {
	const first = asset('first', Uint8Array.of(1, 2, 3));
	const second = asset('second', Uint8Array.of(4, 5, 6));
	const entries = new Map([[first.entry.filename, first.entry], [second.entry.filename, second.entry]]);
	const assets = [first.descriptor, second.descriptor];
	const budget = new ScapeExpandedByteBudget(6);
	await verifyScapeReopenAssets(entries, assets, [], budget);
	assert.equal(budget.usedBytes, 6);
	await assert.rejects(verifyScapeReopenAssets(entries, assets, [], new ScapeExpandedByteBudget(5)), /expanded-byte limit/u);
	await assert.rejects(verifyScapeReopenAssets(entries, [{ ...first.descriptor, sha256: '0'.repeat(64) }], [],
		new ScapeExpandedByteBudget(6)), /SHA-256 verification/u);
});

test('reopen verification rejects missing entries, forged lengths and excessive emissions', async () => {
	const { descriptor, entry } = asset('picture', Uint8Array.of(1, 2, 3));
	await assert.rejects(verifyScapeReopenAssets(new Map(), [descriptor], [], new ScapeExpandedByteBudget(6)), /missing/u);
	await assert.rejects(verifyScapeReopenAssets(new Map([[entry.filename, { ...entry, uncompressedSize: 2 }]]),
		[descriptor], [], new ScapeExpandedByteBudget(6)), /unexpected size/u);
	const huge = asset('huge', new Uint8Array(4 * 1024 * 1024 + 1));
	await assert.rejects(verifyScapeReopenAssets(new Map([[huge.entry.filename, huge.entry]]), [huge.descriptor], [],
		new ScapeExpandedByteBudget(huge.descriptor.size)), /4 MiB chunk limit/u);
});

test('reopen verification preserves cancellation and leaves external media with its local owner', async () => {
	const { descriptor, entry } = asset('external', Uint8Array.of(1));
	const abort = new AbortController(); const reason = new Error('Cancelled'); abort.abort(reason);
	await assert.rejects(verifyScapeReopenAssets(new Map([[entry.filename, entry]]), [descriptor], [],
		new ScapeExpandedByteBudget(6), abort.signal), error => error === reason);
	await verifyScapeReopenAssets(new Map(), [{ ...descriptor, encoding: 'external-file-v1' }], [], new ScapeExpandedByteBudget(6));
});

test('reused video must also match the local immutable body digest and size', async () => {
	const { descriptor, entry } = asset('picture', Uint8Array.of(1, 2, 3));
	const entries = new Map([[entry.filename, entry]]);
	const sources = [{ id: 'picture', storageKey: 'stored-picture' }];
	const store = {
		async *readSourceChunks() { yield []; },
		async getMediaAssetMetadata(key: string) { assert.equal(key, 'stored-picture'); return { sha256: descriptor.sha256, size: 3 }; },
	};
	await verifyScapeReopenAssets(entries, [descriptor], sources, new ScapeExpandedByteBudget(6), undefined, store);
	await assert.rejects(verifyScapeReopenAssets(entries, [descriptor], sources, new ScapeExpandedByteBudget(6), undefined,
		{ ...store, getMediaAssetMetadata: () => Promise.resolve({ sha256: '0'.repeat(64), size: 3 }) }),
	{ name: 'ScapeProjectReopenConflictError' });
});
