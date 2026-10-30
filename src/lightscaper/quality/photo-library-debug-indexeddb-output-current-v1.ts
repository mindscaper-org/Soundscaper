/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../common/media/indexeddb.ts';
import type { DebugOutputStageCurrentV1 } from './photo-library-debug-output-current-v1.ts';
import { debugCleanupFailureCurrentV1 as cleanupFailure } from './photo-library-debug-soak-contract-current-v1.ts';

const DATABASE = 'lightscaper-library-debug-outputs-v1', STORE = 'outputs', MAX_BYTES = 8 * 1024 * 1024;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** A token-scoped durable diagnostic destination, independent of OPFS availability. */
export async function createIndexedDbDebugOutputCurrentV1(factory: IDBFactory, token: string): Promise<DebugOutputStageCurrentV1> {
	if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(token)) {
		throw new TypeError('Diagnostic output requires its allocated UUID token.');
	}
	let versionFailure: Error | undefined;
	const database = await openOutputDatabase(factory, token, error => { versionFailure = error; });
	const assertAvailable = (): void => { if (versionFailure) throw versionFailure; };
	let reserved = false;
	try {
		await transact(database, STORE, 'readwrite', async stores => {
			if (stores[STORE]!.keyPath !== 'token') throw new TypeError('Diagnostic output has an incompatible token store.');
			const key = await request(stores[STORE]!.add({ token, bytes: null }));
			if (key !== token) throw new Error('Diagnostic output did not reserve its actual token.');
		});
		reserved = true; assertAvailable();
	} catch (primary) {
		if (reserved) {
			try {
				await transact(database, STORE, 'readwrite', stores => request(stores[STORE]!.delete(token)));
				const remaining = await transact(database, STORE, 'readonly', stores => request<unknown>(stores[STORE]!.get(token)));
				if (remaining !== undefined) throw new Error('Diagnostic reservation remains after failed acquisition.', { cause: primary });
			} catch (cleanup) { throw cleanupFailure([primary], cleanup, { database, token }); }
		}
		try { database.close(); }
		catch (cleanup) { throw cleanupFailure([primary], cleanup, { database, token }); }
		throw primary;
	}

	let buffer: Uint8Array<ArrayBuffer> | undefined, byteLength = 0, writerClaimed = false;
	let writerState: 'unused' | 'writing' | 'closing' | 'closed' | 'failed' = 'unused';
	let committed = false, retiring = false, retired = false, removal: Promise<void> | undefined;
	const pending = new Set<Promise<unknown>>();
	const wipe = (): void => { buffer?.fill(0); buffer = undefined; byteLength = 0; };
	const assertActive = (): void => {
		assertAvailable();
		if (retiring) throw new Error('Diagnostic output is retiring or retired.');
	};
	const track = <Value>(work: Promise<Value>): Promise<Value> => {
		pending.add(work);
		void work.then(() => { pending.delete(work); }, () => { pending.delete(work); });
		return work;
	};
	const readRow = (): Promise<unknown> => transact(database, STORE, 'readonly', stores => request<unknown>(stores[STORE]!.get(token)));

	const remove = (): Promise<void> => {
		if (retired) return Promise.resolve();
		if (removal) return removal;
		retiring = true;
		const work = (async () => {
			// A pending commit/read remains owned until its native completion, even
			// when its caller has already requested cancellation or removal.
			await Promise.allSettled([...pending]);
			wipe();
			assertAvailable();
			await transact(database, STORE, 'readwrite', stores => request(stores[STORE]!.delete(token)));
			if (await readRow() !== undefined) throw new Error('Diagnostic output token remains after deletion.');
			assertAvailable();
			database.close();
			retired = true; committed = false;
		})();
		removal = work;
		void work.catch(() => { if (removal === work) removal = undefined; });
		return work;
	};

	return {
		async createWritable() {
			assertActive();
			if (writerClaimed) throw new Error('Diagnostic output already has its writer.');
			writerClaimed = true; writerState = 'writing';
			return {
				async write(bytes) {
					assertActive();
					if (writerState !== 'writing') throw new Error('Diagnostic output writer is closed or failed.');
					try {
						if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer)) {
							throw new TypeError('Diagnostic output requires owned byte chunks.');
						}
						if (bytes.byteLength > MAX_BYTES - byteLength) throw new RangeError('Diagnostic output exceeds eight MiB.');
						if (bytes.byteLength) {
							buffer ??= new Uint8Array(MAX_BYTES);
							buffer.set(bytes, byteLength); byteLength += bytes.byteLength;
						}
					} catch (error) { writerState = 'failed'; wipe(); throw error; }
				},
				close() {
					try {
						assertActive();
						if (writerState !== 'writing') throw new Error('Diagnostic output writer is closed or failed.');
					} catch (error) { return Promise.reject(error); }
					writerState = 'closing';
					try {
						// Persist portable bytes rather than a nested Blob: some native
						// IndexedDB engines cannot prepare the actual encoded PNG Blob.
						const payload = buffer ? buffer.slice(0, byteLength) : new Uint8Array();
						return track((async () => {
							try {
								await transact(database, STORE, 'readwrite', stores => request(stores[STORE]!.put({ token, bytes: payload.buffer })));
								assertAvailable(); committed = true; writerState = 'closed';
							} catch (error) { writerState = 'failed'; throw error; }
							finally { payload.fill(0); wipe(); }
						})());
					} catch (error) { writerState = 'failed'; wipe(); return Promise.reject(error); }
				},
				abort: remove,
			};
		},
		async read() {
			assertActive();
			if (!committed) throw new Error('Diagnostic output has no committed bytes.');
			return track((async () => {
				const value = await readRow();
				if (!value || typeof value !== 'object') throw new Error('Diagnostic committed output is missing.');
				const row = value as { token?: unknown; bytes?: unknown };
				if (!(row.bytes instanceof ArrayBuffer)) throw new TypeError('Diagnostic committed output is not its stored ArrayBuffer.');
				const size = Number(Reflect.apply(BUFFER_SIZE, row.bytes, []));
				if (!Number.isSafeInteger(size) || size > MAX_BYTES) throw new RangeError('Diagnostic stored bytes exceed eight MiB.');
				const scratch = new Uint8Array(row.bytes);
				try {
					assertAvailable(); if (row.token !== token) throw new Error('Diagnostic stored output token differs.');
					// Blob copies only this independently retrieved native row. It never
					// borrows the encoder input or the writer's released staging buffer.
					return new Blob([scratch], { type: 'image/png' });
				} finally { scratch.fill(0); }
			})());
		},
		remove,
	};
}

function openOutputDatabase(factory: IDBFactory, token: string, onVersionChange: (error: Error) => void): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		let settled = false, upgradeFailed = false, upgradeError: unknown;
		const opening = factory.open(DATABASE, 1);
		const owner = { opening, token, database: undefined as IDBDatabase | undefined };
		let blockedFailure: AggregateError | undefined;
		opening.onupgradeneeded = event => {
			try {
				if (event.oldVersion !== 0) throw new Error('Diagnostic output has an unsupported database migration.');
				opening.result.createObjectStore(STORE, { keyPath: 'token' });
			} catch (error) {
				upgradeFailed = true; upgradeError = error;
				try { opening.transaction?.abort(); }
				catch (cleanup) { upgradeError = new AggregateError([error, cleanup], 'Diagnostic output upgrade and abort failed.'); }
			}
		};
		opening.onsuccess = () => {
			const database = opening.result;
			if (settled || upgradeFailed) {
				owner.database = database;
				try { database.close(); owner.database = undefined; }
				catch (cleanup) {
					if (blockedFailure) (blockedFailure.errors as unknown[]).push(cleanup);
					else {
						const failure = cleanupFailure(upgradeFailed ? [upgradeError] : [], cleanup, owner);
						if (!settled) reject(failure);
					}
				}
				if (!settled) reject(upgradeError);
				settled = true; return;
			}
			database.onversionchange = () => {
				let error: Error = new Error('Diagnostic output database changed version.');
				try { database.close(); }
				catch (cleanup) { error = new AggregateError([error, cleanup], 'Diagnostic output version change could not close its handle.'); }
				onVersionChange(error);
			};
			settled = true; resolve(database);
		};
		opening.onerror = () => {
			if (settled) return;
			settled = true; reject(upgradeFailed ? upgradeError : opening.error ?? new Error('Could not open diagnostic output.'));
		};
		opening.onblocked = () => {
			if (settled) return;
			// A blocked request cannot be canceled. Retain it and close any later
			// connection without turning this failed acquisition into success.
			blockedFailure = cleanupFailure([], new Error('Diagnostic output database open is blocked; native request remains owned.'), owner);
			settled = true; reject(blockedFailure);
		};
	});
}
