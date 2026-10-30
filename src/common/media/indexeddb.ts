/* SPDX-License-Identifier: AGPL-3.0-only */

const DEFAULT_INDEXEDDB_CURSOR_PAGE_SIZE = 8;

export const MAX_INDEXEDDB_CURSOR_PAGE_SIZE = 64;

export type IndexedDBCursorProjector<RecordValue> = (
	value: unknown,
	primaryKey: IDBValidKey,
) => RecordValue;

export async function transact<Result>(
	database: IDBDatabase,
	storeNames: string | readonly string[],
	mode: IDBTransactionMode,
	operation: (
		stores: Readonly<Record<string, IDBObjectStore>>,
		transaction: IDBTransaction,
	) => Result | Promise<Result>,
): Promise<Result> {
	const names = Array.isArray(storeNames) ? [...storeNames] : [storeNames];
	const transaction = database.transaction(names, mode);
	const stores = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name)]));
	const completion = transactionCompletion(transaction);
	let result: Result;
	try {
		result = await operation(stores, transaction);
	} catch (error) {
		try { transaction.abort(); } catch { /* Transaction may already be inactive. */ }
		try { await completion; } catch { /* Preserve the operation's primary failure. */ }
		throw error;
	}
	await completion;
	return result;
}

export function request<Result>(idbRequest: IDBRequest<Result>): Promise<Result> {
	return new Promise((resolve, reject) => {
		idbRequest.onsuccess = () => resolve(idbRequest.result);
		idbRequest.onerror = () => reject(idbRequest.error || new Error('An IndexedDB request failed.'));
	});
}

/**
 * Read a hard-capped cursor page, synchronously projecting each delivered value
 * before it enters the retained page. Callers open a new transaction for every
 * page, so pausing an async iterator never retains a browser transaction.
 */
export function readCursorPage<RecordValue = unknown>(
	source: IDBObjectStore | IDBIndex,
	{
		query,
		afterPrimaryKey,
		maximumPrimaryKey,
		limit = DEFAULT_INDEXEDDB_CURSOR_PAGE_SIZE,
		project = identityCursorValue<RecordValue>,
	}: {
		readonly query?: IDBValidKey | IDBKeyRange;
		readonly afterPrimaryKey?: IDBValidKey;
		readonly maximumPrimaryKey?: IDBValidKey;
		readonly limit?: number;
		readonly project?: IndexedDBCursorProjector<RecordValue>;
	} = {},
): Promise<RecordValue[]> {
	const maximumRecords = Math.min(
		positiveInteger(limit, DEFAULT_INDEXEDDB_CURSOR_PAGE_SIZE),
		MAX_INDEXEDDB_CURSOR_PAGE_SIZE,
	);
	return new Promise((resolve, reject) => {
		const records: RecordValue[] = [];
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try {
			cursorRequest = query === undefined ? source.openCursor() : source.openCursor(query);
		} catch (error) {
			reject(error);
			return;
		}
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate IndexedDB records.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve(records);
				return;
			}
			if (maximumPrimaryKey !== undefined
				&& compareStringKeys(cursor.primaryKey, maximumPrimaryKey) > 0) {
				resolve(records);
				return;
			}
			if (afterPrimaryKey !== undefined) {
				const comparison = compareStringKeys(cursor.primaryKey, afterPrimaryKey);
				if (comparison < 0) {
					try {
						if (query !== undefined) {
							if (typeof cursor.continuePrimaryKey === 'function') cursor.continuePrimaryKey(cursor.key, afterPrimaryKey);
							else cursor.continue();
						} else {
							cursor.continue(afterPrimaryKey);
						}
					} catch (error) {
						reject(error);
					}
					return;
				}
				if (comparison === 0) {
					cursor.continue();
					return;
				}
			}
			try {
				records.push(project(cursor.value, cursor.primaryKey));
			} catch (error) {
				reject(error);
				return;
			}
			if (records.length >= maximumRecords) {
				resolve(records);
				return;
			}
			cursor.continue();
		};
	});
}

export function transactionCompletion(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error || new Error('The IndexedDB transaction was aborted.'));
		transaction.onerror = () => reject(transaction.error || new Error('The IndexedDB transaction failed.'));
	});
}

export function deleteByIndex(index: IDBIndex, key: IDBValidKey): Promise<void> {
	return new Promise((resolve, reject) => {
		const cursorRequest = index.openKeyCursor(key);
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate IndexedDB records.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve();
				return;
			}
			index.objectStore.delete(cursor.primaryKey);
			cursor.continue();
		};
	});
}

function compareStringKeys(left: IDBValidKey, right: IDBValidKey): number {
	if (left === right) return 0;
	return String(left) < String(right) ? -1 : 1;
}

function positiveInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function identityCursorValue<RecordValue>(value: unknown): RecordValue {
	return value as RecordValue;
}
