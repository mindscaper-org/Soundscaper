/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const cleanupFailures = new WeakSet<object>();
/** Exact owning cleanup witness; never inspect arbitrary caller abort reasons. */
export function isLightscaperNativeSmartCollectionCleanupFailureCurrentV1(value: unknown): boolean {
	return value !== null && typeof value === 'object' && cleanupFailures.has(value);
}
export function assertLightscaperNativeSmartCollectionNotAbortedCurrentV1(signal?: AbortSignal): void {
	if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []);
}

/** Internal synchronous SQL boundary; never keep a snapshot across an await.
 * A completed COMMIT is the write ACK, including when cancellation arrives later. */
export function withLightscaperNativeSmartCollectionTransactionCurrentV1<Result>(database: DatabaseSync,
	mode: 'read' | 'write', signal: AbortSignal | undefined, operation: () => Result): Result {
	if (database.isTransaction) throw new Error('Native saved collection operations require their own transaction.');
	assertLightscaperNativeSmartCollectionNotAbortedCurrentV1(signal);
	database.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN');
	try {
		const result = operation();
		assertLightscaperNativeSmartCollectionNotAbortedCurrentV1(signal);
		database.exec('COMMIT'); return result;
	} catch (error) {
		if (database.isTransaction) {
			try { database.exec('ROLLBACK'); }
			catch (cleanup) {
				const failure = new AggregateError([error, cleanup], 'Native saved collection work and rollback failed.');
				cleanupFailures.add(failure); throw failure;
			}
		}
		throw error;
	}
}
