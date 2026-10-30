/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import { openDatabase } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { request, transact } from '../../src/common/media/indexeddb.ts';
import { MediaRepository } from '../../src/common/editor/storage/media-repository.ts';
import { getMemoryDatabase } from '../../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../../src/common/editor/storage/opfs-repository.ts';
import type { CatalogOriginalRepairBindingV1 } from '../../src/common/editor/storage/media-catalog-original-repair-contract.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

export const REPAIR_BYTES = Uint8Array.of(1, 3, 5, 7);
export const REPAIR_DIGEST = createHash('sha256').update(REPAIR_BYTES).digest('hex');
export type OriginalLayout = 'inline' | 'chunks' | 'opfs';

export async function createRepairFixture(context: TestContext, layout: OriginalLayout = 'inline', provisional = false) {
	const indexedDB = createInstrumentedIndexedDB(), databaseName = `repair-original-${crypto.randomUUID()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const transactions: Array<{ names: string[]; mode: IDBTransactionMode | undefined }> = [];
	let observe: ((transaction: IDBTransaction, names: readonly string[], mode?: IDBTransactionMode) => void) | null = null;
	const nativeTransaction = database.transaction.bind(database);
	database.transaction = (names, mode, options) => {
		const scope = typeof names === 'string' ? [names] : [...names];
		transactions.push({ names: scope, mode });
		const transaction = nativeTransaction(names, mode, options);
		observe?.(transaction, scope, mode);
		return transaction;
	};
	const opfs = fakeRepairOpfs();
	const storage = new OpfsRepository({ preferOpfs: layout === 'opfs', opfsRoot: opfs.directory as unknown as FileSystemDirectoryHandle, syncWorkerClient: null });
	const port = { memory: getMemoryDatabase(databaseName), database: async () => database };
	const media = new MediaRepository(port, storage);
	let closing: Promise<void> | undefined, forcedFailure: unknown;
	const terminals = new Set<() => void>();
	const ownTerminal = (retire: () => void): (() => void) => {
		if (closing) { retire(); return () => undefined; }
		terminals.add(retire); return () => { terminals.delete(retire); };
	};
	const close = (): Promise<void> => {
		if (closing) return closing;
		let resolve!: () => void, reject!: (reason: unknown) => void;
		closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		clearTimeout(timer); context.signal.removeEventListener('abort', stop);
		opfs.releaseAll();
		void (async () => {
			const errors: unknown[] = [];
			for (const retire of [...terminals]) try { retire(); } catch (error) { errors.push(error); }
			try { await media.beginAssetMaintenance({ permanent: true }).abortActive(); } catch (error) { errors.push(error); }
			try { storage.close(); } catch (error) { errors.push(error); }
			try { database.close(); } catch (error) { errors.push(error); }
			if (forcedFailure !== undefined) errors.unshift(forcedFailure);
			if (errors.length) throw new AggregateError(errors, 'Repair fixture owners did not retire cleanly.');
		})().then(resolve, reject);
		return closing;
	};
	const stop = (): void => {
		forcedFailure ??= context.signal.reason ?? new Error('Repair fixture exceeded its 13-second active deadline.');
		opfs.releaseAll(forcedFailure); void close().catch(() => undefined);
	};
	context.after(close);
	const timer = setTimeout(stop, 13_000); context.signal.addEventListener('abort', stop, { once: true });
	if (context.signal.aborted) stop();
	const binding: CatalogOriginalRepairBindingV1 = { catalogId: 'catalog', importId: provisional ? 'import' : null,
		photoId: 'photo', assetId: 'original-asset', sourceId: 'logical-original', sha256: REPAIR_DIGEST,
		size: REPAIR_BYTES.length, name: 'Immutable camera name.png', mimeType: 'image/png' };
	if (layout !== 'inline') {
		const writer = await media.beginAssetWrite(binding.assetId, { name: binding.name, mimeType: binding.mimeType, note: 'keep metadata' },
			{ expectedBytes: binding.size, expectedSha256: binding.sha256 });
		await writer.write(REPAIR_BYTES); await writer.commit();
	} else await media.writeAsset(binding.assetId, new Blob([REPAIR_BYTES]), { name: binding.name, mimeType: binding.mimeType, note: 'keep metadata' });
	const seeded = indexedDB.records(databaseName, 'mediaAssets')[0] as Record<string, unknown>;
	assert.equal(seeded.storage, layout === 'opfs' ? 'opfs' : layout === 'chunks' ? 'indexeddb-media-chunks-v1' : 'indexeddb-blob');
	if (layout === 'opfs') assert.ok(typeof seeded.path === 'string' && opfs.files.has(seeded.path), 'the initial modeled retained path must actually exist');
	if (provisional) await media.catalogOriginals.stage(binding.catalogId, 'import', [reference(binding)]);
	else await media.catalogOriginals.retain(binding.catalogId, [reference(binding)]);
	return { indexedDB, databaseName, database, media, storage, opfs, port, binding, transactions, close, ownTerminal,
		observe: (next: typeof observe) => { observe = next; },
		row: () => indexedDB.records(databaseName, 'mediaAssets')[0] as Record<string, unknown> | undefined,
		roots: () => indexedDB.records(databaseName, 'catalogOriginalRoots') as Array<Record<string, unknown>>,
		removeRow: () => transact(database, 'mediaAssets', 'readwrite', async ({ mediaAssets }) => { await request(mediaAssets.delete(binding.assetId)); }),
	};
}

export type RepairFixture = Awaited<ReturnType<typeof createRepairFixture>>;

export function reference(binding: CatalogOriginalRepairBindingV1) {
	return { photoId: binding.photoId, assetId: binding.assetId, sourceId: binding.sourceId, sha256: binding.sha256, size: binding.size };
}

export function assertNoRepairLease(fixture: RepairFixture): void {
	const staging = fixture.indexedDB.records(fixture.databaseName, 'mediaAssetStaging') as Array<Record<string, unknown>>;
	assert.equal(staging.filter(({ kind }) => kind === 'lease').length, 0);
}

export function deferred() {
	let resolve!: () => void, reject!: (reason: unknown) => void;
	const promise = new Promise<void>((done, refuse) => { resolve = done; reject = refuse; });
	return { promise, resolve, reject };
}

function fakeRepairOpfs() {
	const files = new Map<string, Blob>();
	let writeGate: ReturnType<typeof deferred> | null = null, closeGate: ReturnType<typeof deferred> | null = null;
	let abortGate: ReturnType<typeof deferred> | null = null;
	let entered = deferred(), failRemoval = false;
	const held = new Set<{ gate: ReturnType<typeof deferred>; observed: ReturnType<typeof deferred> }>();
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('missing', 'NotFoundError');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				async createWritable() {
					const parts: BlobPart[] = [];
					return {
						async write(part: BlobPart) { if (writeGate) { entered.resolve(); await writeGate.promise; } parts.push(part); },
						async close() { if (closeGate) { entered.resolve(); await closeGate.promise; } files.set(path, new Blob(parts)); },
						async abort() { if (abortGate) { entered.resolve(); await abortGate.promise; } },
					};
				},
				async getFile() { const file = files.get(path); if (!file) throw new DOMException('missing', 'NotFoundError'); return file; },
			};
		},
		async removeEntry(path: string) {
			if (failRemoval) throw new DOMException('planned removal refusal', 'NotAllowedError');
			if (!files.delete(path)) throw new DOMException('missing', 'NotFoundError');
		},
	};
	return { files, directory,
		releaseAll: (reason?: unknown): void => {
			for (const owner of held) { owner.gate.resolve(); if (reason !== undefined) owner.observed.reject(reason); }
			held.clear();
		},
		hold: (kind: 'write' | 'close' | 'abort') => {
			entered = deferred(); const gate = deferred(), owner = { gate, observed: entered }; held.add(owner);
			void entered.promise.catch(() => undefined);
			if (kind === 'write') writeGate = gate; else if (kind === 'close') closeGate = gate; else abortGate = gate;
			return { entered: entered.promise, release: () => { gate.resolve(); held.delete(owner); } };
		},
		failRemoval: () => { failRemoval = true; },
	};
}
