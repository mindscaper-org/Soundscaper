/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyScapeReopenAssets } from '../src/common/editor/scape-project-reopen-assets.ts';
import { ScapeExpandedByteBudget } from '../src/common/scape/expanded-byte-budget.ts';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../src/common/scape/archive-envelope.ts';

function asset(name: string, bytes: Uint8Array) {
	const descriptor: ScapeAssetDescriptor = { sourceId: name, kind: 'video', encoding: 'original', entry: name,
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
		async getMediaAssetMetadata(key: string, options?: { verifyOpfsBodySize?: boolean }) {
			assert.equal(key, 'stored-picture');
			assert.equal(options?.verifyOpfsBodySize, true);
			return { sha256: descriptor.sha256, size: 3 };
		},
	};
	await verifyScapeReopenAssets(entries, [descriptor], sources, new ScapeExpandedByteBudget(6), undefined, store);
	await assert.rejects(verifyScapeReopenAssets(entries, [descriptor], sources, new ScapeExpandedByteBudget(6), undefined,
		{ ...store, getMediaAssetMetadata: () => Promise.resolve({ sha256: '0'.repeat(64), size: 3 }) }),
	{ name: 'ScapeProjectReopenConflictError' });
});

test('valid archive PCM offers a separate copy when its local body is missing, preserving storage faults', async () => {
	const bytes = new Uint8Array(8);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 1, true);
	view.setFloat32(4, .25, true);
	const { descriptor, entry } = asset('audio', bytes);
	const entries = new Map([[entry.filename, entry]]);
	const assets: ScapeAssetDescriptor[] = [{ ...descriptor, kind: 'audio', encoding: 'audio-f32le-chunks-v1' }];
	const sources = [{ id: 'audio', storageKey: 'local-audio', frameCount: 1, chunkFrames: 1, channelCount: 1 }];
	const verify = (failure: Error) => verifyScapeReopenAssets(entries, assets, sources, new ScapeExpandedByteBudget(8), undefined, {
		async *readSourceChunks(key: string) {
			assert.equal(key, 'local-audio');
			yield await Promise.reject<readonly Float32Array[]>(failure);
		},
	});
	const missing = new Error('The requested local audio source is missing.', { cause: new DOMException('Missing', 'NotFoundError') });
	await assert.rejects(verify(missing), { name: 'ScapeProjectReopenConflictError' });
	const denied = new DOMException('Storage access denied', 'NotAllowedError');
	await assert.rejects(verify(denied), error => error === denied);
});
