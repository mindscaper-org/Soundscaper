/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { CATALOG_ORIGINAL_ROOT_STORE_NAME } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import type { MediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const ORIGINAL = new TextEncoder().encode('original');
const ORIGINAL_SHA256 = createHash('sha256').update(ORIGINAL).digest('hex');
type Store = ReturnType<typeof createProjectStore>;
type PublicationMode = 'streamed' | 'blob';
interface PublicationFault { assertFault(): void; cancel(): void; restore(): void }
interface MediaFixture {
	readonly store: Store;
	readonly files: Map<string, Blob>;
	readonly publicationError: Error;
	readonly signal: AbortSignal;
	streamOriginal(): Promise<Readonly<Record<string, unknown>>>;
	fault(mode: PublicationMode, reconciliationError?: Error): PublicationFault;
}

void test('ordinary streamed OPFS media commit reconciles a committed row after terminal acknowledgement fails', { timeout: 15_000 }, async context => {
	await withMediaFixture(context, 'committed', true, async fixture => {
		const fault = fixture.fault('streamed');
		const metadata = await fixture.streamOriginal();
		fault.assertFault();
		assert.equal(metadata.storage, 'opfs');
		assert.equal(metadata.sha256, ORIGINAL_SHA256);
		assert.equal(metadata.size, ORIGINAL.byteLength);
		assert.equal(fixture.files.size, 1);
		assert.equal(await readMedia(fixture), 'original');
	});
});

void test('ordinary Blob-backed media write reconciles a committed row after terminal acknowledgement fails', { timeout: 15_000 }, async context => {
	await withMediaFixture(context, 'blob-committed', false, async fixture => {
		const fault = fixture.fault('blob');
		const metadata = await fixture.store.writeMediaAsset('video-source', new Blob([ORIGINAL]), {}, { signal: fixture.signal });
		fault.assertFault();
		assert.equal(metadata.storage, 'indexeddb-blob');
		assert.equal(metadata.sha256, ORIGINAL_SHA256);
		assert.equal(metadata.size, ORIGINAL.byteLength);
		assert.equal(fixture.files.size, 0);
		assert.equal(await readMedia(fixture), 'original');
	});
});

void test('ordinary streamed OPFS media commit retains its file when publication reconciliation cannot read the row', { timeout: 15_000 }, async context => {
	await withMediaFixture(context, 'indeterminate', true, async fixture => {
		const reconciliationError = new Error('media reconciliation unavailable');
		const fault = fixture.fault('streamed', reconciliationError);
		await assert.rejects(fixture.streamOriginal(), (error: unknown) => error instanceof AggregateError
			&& error.errors[0] === fixture.publicationError && error.errors[1] === reconciliationError);
		fault.assertFault();
		assert.equal(fixture.files.size, 1);
		assert.equal(await readMedia(fixture), 'original');
	});
});

async function withMediaFixture(
	context: TestContext,
	label: string,
	preferOpfs: boolean,
	run: (fixture: MediaFixture) => Promise<void>,
): Promise<void> {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `ordinary-media-reconcile-${label}-${crypto.randomUUID()}`;
	const files = new Map<string, Blob>(), faults = new Set<PublicationFault>();
	const writers = new Set<MediaAssetWriter>(), retiredWriters = new Set<MediaAssetWriter>();
	const retirements: Promise<void>[] = [], cleanupErrors: unknown[] = [];
	const store = createProjectStore({ indexedDB, databaseName, memoryFallback: false, preferOpfs, opfsRoot: fakeOpfs(files) });
	const caller = new AbortController(), publicationError = new Error('media completion acknowledgement lost');
	let database: IDBDatabase | undefined, closing: Promise<void> | undefined, expired = false;
	let failed = false, primary: unknown;
	const retireWriter = (writer: MediaAssetWriter): void => {
		if (retiredWriters.has(writer)) return;
		retiredWriters.add(writer);
		const retirement = Promise.resolve().then(() => writer.abort());
		retirements.push(retirement); void retirement.catch(() => undefined);
	};
	const stop = (reason: unknown): void => {
		if (!caller.signal.aborted) caller.abort(reason);
		for (const fault of faults) { try { fault.cancel(); } catch (error) { cleanupErrors.push(error); } }
		for (const writer of writers) retireWriter(writer);
		if (!closing) { closing = store.close(); void closing.catch(() => undefined); }
	};
	const cancel = () => { stop(context.signal.reason ?? new Error('Media reconciliation test cancelled.')); };
	context.signal.addEventListener('abort', cancel, { once: true });
	const deadline = setTimeout(() => {
		expired = true; stop(new Error('Media reconciliation operation exceeded its active cleanup deadline.'));
	}, 12_000);
	try {
		await store.ready();
		database = await new Promise<IDBDatabase>((resolve, reject) => {
			const opening = indexedDB.open(databaseName) as unknown as IDBOpenDBRequest;
			opening.onsuccess = () => { resolve(opening.result); };
			opening.onerror = () => { reject(opening.error); };
		});
		caller.signal.throwIfAborted();
		const actualDatabase = database;
		await run({ store, files, publicationError, signal: caller.signal,
			async streamOriginal() {
				const writer = await store.beginMediaAssetWrite('video-source', {}, {
					expectedBytes: ORIGINAL.byteLength, expectedSha256: ORIGINAL_SHA256, signal: caller.signal,
				});
				writers.add(writer);
				if (caller.signal.aborted) { retireWriter(writer); caller.signal.throwIfAborted(); }
				await writer.write(ORIGINAL, { signal: caller.signal });
				// The ordinary commit mode, never an owned/rooted proxy publication.
				return writer.commit({ signal: caller.signal });
			},
			fault(mode, reconciliationError) {
				const fault = injectPublicationCompletionFailure(actualDatabase, mode, publicationError, reconciliationError);
				faults.add(fault); return fault;
			},
		});
		assert.equal(expired, false, 'a deadline cannot certify successful reconciliation');
	} catch (error) { failed = true; primary = error; }
	finally {
		stop(new Error('Media reconciliation fixture retired.'));
		for (const fault of faults) { try { fault.restore(); } catch (error) { cleanupErrors.push(error); } }
		for (const result of await Promise.allSettled(retirements)) if (result.status === 'rejected') cleanupErrors.push(result.reason);
		if (closing) { try { await closing; } catch (error) { cleanupErrors.push(error); } }
		try { database?.close(); } catch (error) { cleanupErrors.push(error); }
		context.signal.removeEventListener('abort', cancel); clearTimeout(deadline);
		if (indexedDB.stats.activeTransactions !== 0) cleanupErrors.push(new Error('Actual IndexedDB transactions remain active.'));
	}
	if (cleanupErrors.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanupErrors],
		'Media reconciliation fixture and cleanup failed.', { cause: failed ? primary : cleanupErrors[0] });
	if (failed) throw primary;
}

async function readMedia(fixture: MediaFixture): Promise<string | null> {
	const loaded = await fixture.store.loadMediaAsset('video-source', { signal: fixture.signal });
	return loaded ? new TextDecoder().decode(await loaded.arrayBuffer()) : null;
}

interface CompletionTarget {
	readonly transaction: IDBTransaction;
	complete: IDBTransaction['oncomplete'];
	completed: boolean;
}

function injectPublicationCompletionFailure(
	database: IDBDatabase,
	mode: PublicationMode,
	publicationError: Error,
	reconciliationError?: Error,
): PublicationFault {
	const originalDescriptor = Object.getOwnPropertyDescriptor(database, 'transaction');
	const originalTransaction = database.transaction.bind(database), targets: CompletionTarget[] = [];
	const publicationStores = ['mediaAssets', CATALOG_ORIGINAL_ROOT_STORE_NAME,
		...(mode === 'streamed' ? [MEDIA_ASSET_STAGING_STORE_NAME] : [])];
	const reconciliationStores = ['mediaAssets', ...(mode === 'streamed' ? [MEDIA_ASSET_STAGING_STORE_NAME] : [])];
	let injected = false, failedRead = false, terminalDeliveries = 0;
	const sameStores = (actual: string[], expected: string[]) => actual.length === expected.length
		&& expected.every(name => actual.includes(name));
	Object.defineProperty(database, 'transaction', { configurable: true,
		value(storeNames: string | string[], transactionMode?: IDBTransactionMode) {
			const names = Array.isArray(storeNames) ? storeNames : [storeNames];
			if (injected && !failedRead && reconciliationError && transactionMode === 'readonly'
				&& sameStores(names, reconciliationStores)) { failedRead = true; throw reconciliationError; }
			const transaction = originalTransaction(storeNames, transactionMode);
			if (!injected && transactionMode === 'readwrite' && sameStores(names, publicationStores)) {
				injected = true;
				const target: CompletionTarget = { transaction, complete: null, completed: false }; targets.push(target);
				Object.defineProperty(transaction, 'oncomplete', { configurable: true,
					set(value: IDBTransaction['oncomplete']) { target.complete = value; },
					get() { return () => {
						// Native-shaped completion has already committed the actual rows.
						target.completed = true; terminalDeliveries += 1;
						Object.defineProperty(transaction, 'error', { configurable: true, value: publicationError });
						transaction.onabort?.call(transaction, new Event('abort'));
					}; },
				});
			}
			return transaction;
		},
	});
	return {
		assertFault() {
			assert.equal(injected, true, 'The actual ordinary publication must enter the exact fault boundary.');
			assert.equal(terminalDeliveries, 1, 'The row transaction must really complete before its ACK fails.');
			if (reconciliationError) assert.equal(failedRead, true, 'The actual reconciliation read must fail.');
		},
		cancel() {
			for (const target of targets) {
				if (target.completed) {
					// Release an intercepted completion only after real native retirement.
					// The test still fails its deadline; this is cleanup, never a PASS proof.
					target.complete?.call(target.transaction, new Event('complete'));
				} else target.transaction.abort();
			}
		},
		restore() {
			if (originalDescriptor) Object.defineProperty(database, 'transaction', originalDescriptor);
			else Reflect.deleteProperty(database, 'transaction');
		},
	};
}

function fakeOpfs(files: Map<string, Blob>): FileSystemDirectoryHandle {
	// Explicit test filesystem port for the actual streamed writer, not a
	// native whole-Blob capability witness. Blob fallback disables OPFS.
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('missing', 'NotFoundError');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				kind: 'file',
				async createWritable() {
					const parts: BlobPart[] = [];
					return {
						async write(part: BlobPart) { parts.push(part); },
						async close() { files.set(path, new Blob(parts)); },
						async abort() {},
					};
				},
				async getFile() { return files.get(path) as Blob; },
			};
		},
		async removeEntry(path: string) { files.delete(path); },
	};
	return directory as unknown as FileSystemDirectoryHandle;
}
