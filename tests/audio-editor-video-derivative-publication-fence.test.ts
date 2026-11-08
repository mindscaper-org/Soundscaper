/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from '../src/common/editor/storage/derivative-cache-entry.ts';
import type { MediaAssetWriteOptions, MediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import type { BlobLike } from '../src/common/editor/storage/media-records.ts';
import { freshVerifiedMediaContentDigest } from '../src/common/editor/storage/media-content-provenance.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

interface InstrumentedIndexedDB {
	open(name: string, version?: number): IDBOpenDBRequest;
	records(databaseName: string, storeName: string): Record<string, unknown>[];
	seedRecord(databaseName: string, storeName: string, value: unknown, primaryKey?: IDBValidKey): void;
}

interface DerivativeStore {
	readonly memory: {
		readonly mediaAssets: Map<string, unknown>;
		readonly videoDerivatives: Map<string, unknown>;
	};
	ready(): Promise<unknown>;
	writeMediaAsset(sourceId: string, blob: Blob): Promise<Record<string, unknown>>;
	beginMediaAssetWrite(sourceId: string, metadata: Record<string, unknown>, options: MediaAssetWriteOptions): Promise<MediaAssetWriter>;
	loadMediaAsset(sourceId: string): Promise<BlobLike | null>;
	close(): Promise<void>;
	saveVideoDerivative(sourceId: string, input: Readonly<{
		readonly type: string;
		readonly blob: Blob;
	}>): Promise<Record<string, unknown>>;
	loadVideoDerivative(
		sourceId: string,
		selector: Readonly<{ type: string }>,
	): Promise<Blob | null>;
}

for (const backend of ['memory', 'indexeddb'] as const) {
	void test(`${backend} publication rejects an original generation changed after staging`, { timeout: 15_000 }, async () => {
		const indexedDB = backend === 'indexeddb'
			? createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB
			: null;
		const databaseName = `video-derivative-publication-fence-${backend}-${Date.now()}-${Math.random()}`;
		const opfs = createOpfsHarness();
		const store = createProjectStore({
			indexedDB,
			memoryFallback: backend === 'memory',
			preferOpfs: true,
			opfsRoot: opfs.directory,
			databaseName,
		}) as unknown as DerivativeStore;
		try {
			await store.ready();
			// This Node filesystem port models streaming, never native whole-Blob path authority.
			const bytes = new TextEncoder().encode('original-video');
			const sha256 = createHash('sha256').update(bytes).digest('hex');
			const writer = await store.beginMediaAssetWrite('video-source', {}, { expectedBytes: bytes.byteLength, expectedSha256: sha256 });
			let original: Readonly<Record<string, unknown>>;
			try { await writer.write(bytes); original = await writer.commit(); }
			finally { await writer.abort(); }
			assert.equal(original.sha256, sha256); assert.equal(original.size, bytes.byteLength);
			assert.equal(original.storage, backend === 'indexeddb' ? 'opfs' : 'indexeddb-media-chunks-v1');
			const originalPath = original.path;
			if (backend === 'indexeddb') { assert.equal(typeof originalPath, 'string'); assert.ok(opfs.files.has(originalPath as string)); }
			const originalRecord = () => backend === 'indexeddb'
				? onlyRecord(indexedDB?.records(databaseName, 'mediaAssets') ?? [])
				: memoryOriginal(store);
			const rawOriginal = originalRecord();
			const nextGeneration = freshVerifiedMediaContentDigest(rawOriginal.sha256);
			assert.notEqual(nextGeneration.mediaContentToken, rawOriginal.mediaContentToken);
			let stagedCloses = 0;
			opfs.arm(() => {
				stagedCloses += 1;
				const paths = opfs.derivativePaths(); assert.equal(paths.length, 1);
				assert.equal(opfs.files.get(paths[0])?.size, new Blob(['staged-poster']).size);
				const replacement = { ...rawOriginal, ...nextGeneration };
				if (backend === 'indexeddb') indexedDB?.seedRecord(databaseName, 'mediaAssets', replacement);
				else store.memory.mediaAssets.set('video-source', replacement);
			});

			await assert.rejects(
				store.saveVideoDerivative('video-source', { type: 'poster', blob: new Blob(['staged-poster']) }),
				/verified original media.*changed during derivative publication/iu,
			);

			assert.equal(stagedCloses, 1, 'the generation changes only after actual derivative staging');
			assert.equal(opfs.derivativePaths().length, 0, 'the staged derivative file is removed');
			assert.deepEqual(originalRecord(), { ...rawOriginal, ...nextGeneration }, 'publication preserves the replacement original record');
			if (backend === 'indexeddb') {
				assert.equal(opfs.files.has(originalPath as string), true, 'the unrelated retained-original file is preserved');
				assert.deepEqual(indexedDB?.records(databaseName, VIDEO_DERIVATIVE_STORE_NAME), []);
				assert.deepEqual(indexedDB?.records(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME), []);
			} else {
				assert.equal(store.memory.videoDerivatives.size, 0);
			}
			const retained = await store.loadMediaAsset('video-source'); assert.ok(retained);
			const actual = new Uint8Array(await retained.arrayBuffer());
			assert.deepEqual(actual, bytes); assert.equal(createHash('sha256').update(actual).digest('hex'), sha256);
		} finally { await store.close(); }
	});
}

void test('equal-size OPFS derivative corruption fails the output digest check', { timeout: 15_000 }, async context => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
	const databaseName = `video-derivative-opfs-integrity-${Date.now()}-${Math.random()}`;
	const opfs = createOpfsHarness();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: true,
		opfsRoot: opfs.directory,
		databaseName,
	}) as unknown as DerivativeStore;
	context.after(async () => { await store.close(); });
	await store.ready();
	await store.writeMediaAsset('video-source', new Blob(['original-video']));
	const derivative = await store.saveVideoDerivative('video-source', {
		type: 'poster', blob: new Blob(['poster-body']),
	});
	assert.equal(derivative.storage, 'opfs'); assert.equal(typeof derivative.path, 'string');
	const derivativePath = derivative.path as string;
	opfs.files.set(derivativePath, new Blob(['altered-bod']));

	await assert.rejects(
		store.loadVideoDerivative('video-source', { type: 'poster' }),
		/derivative.*digest integrity/iu,
	);
});

function createOpfsHarness(): Readonly<{
	readonly directory: FileSystemDirectoryHandle;
	readonly files: Map<string, Blob>;
	arm(callback: () => void): void;
	derivativePaths(): string[];
}> {
	const files = new Map<string, Blob>();
	let afterNextClose: (() => void) | null = null;
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new Error('missing');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				async createWritable() {
					const parts: BlobPart[] = [];
					return {
						async write(part: BlobPart) { parts.push(part); },
						async close() {
							files.set(path, new Blob(parts));
							const callback = afterNextClose;
							afterNextClose = null;
							callback?.();
						},
						async abort() { parts.length = 0; },
					};
				},
				async getFile() { return files.get(path) as Blob; },
			};
		},
		async removeEntry(path: string) {
			if (!files.delete(path)) throw new Error('missing');
		},
	};
	return {
		directory: directory as unknown as FileSystemDirectoryHandle,
		files,
		arm(callback) { afterNextClose = callback; },
		derivativePaths() { return [...files.keys()].filter((path) => path.startsWith('video-')); },
	};
}

function onlyRecord(records: readonly Record<string, unknown>[]): Record<string, unknown> {
	assert.equal(records.length, 1);
	return records[0];
}

function memoryOriginal(store: DerivativeStore): Record<string, unknown> {
	const value = store.memory.mediaAssets.get('video-source');
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}
