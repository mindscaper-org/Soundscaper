/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';

export const ORIGINAL_HEAD_TEST_OPTIONS_CURRENT_V1 = { concurrency: false, timeout: 15_000 };
export const ORIGINAL_HEAD_SHA_CURRENT_V1 = 'a'.repeat(64);
export const ORIGINAL_HEAD_BINDING_CURRENT_V1 = Object.freeze({ storageKey: 'original', contentSha256: ORIGINAL_HEAD_SHA_CURRENT_V1, byteLength: 3 });
export const ORIGINAL_HEAD_ID_CURRENT_V1 = 'b'.repeat(64);

/** Genuine scalar-only SQLite fixture, not body/custody provenance. All
 * handles join before rm; a failed close retains its private file evidence. */
export async function originalHeadFixtureCurrentV1(context: TestContext,
	run: (database: DatabaseSync, path: string, directory: string) => void | Promise<void>): Promise<void> {
	context.signal.throwIfAborted();
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-native-original-head-'));
	const path = join(directory, 'originals.sqlite3'); let database: DatabaseSync | undefined, failed = false, primary: unknown;
	try { database = new DatabaseSync(path); context.signal.throwIfAborted(); await run(database, path, directory); }
	catch (error) { failed = true; primary = error; }
	try { database?.close(); }
	catch (cleanup) { throw new AggregateError([...(failed ? [primary] : []), cleanup], 'Native head fixture failed actual database retirement.', { cause: cleanup }); }
	await rm(directory, { recursive: true, force: true }); if (failed) throw primary;
}
export function immediateOriginalHeadCurrentV1<Result>(database: DatabaseSync, run: () => Result): Result {
	database.exec('BEGIN IMMEDIATE');
	try { const result = run(); database.exec('COMMIT'); return result; }
	catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Head test transaction and real rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}
