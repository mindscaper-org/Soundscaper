/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativePhotoOriginalIndexCurrentV1 as Index } from '../desktop/lightscaper-native-original-index-current-v1.ts';
const OPTIONS = { concurrency: false, timeout: 15_000 };
const BINDING = Object.freeze({ storageKey: 'asset', contentSha256: 'a'.repeat(64), byteLength: 1 });

/** Observe the result of the genuine SQLite get, before the owning JS validator.
	* This neither fabricates row data nor substitutes a fake database/statement. */
function observeBindingReceipts(database: DatabaseSync, receipts: unknown[]): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(database, 'prepare');
	const nativePrepare = database.prepare;
	Object.defineProperty(database, 'prepare', { configurable: true, value: function (this: DatabaseSync, sql: string): StatementSync {
	 const statement = Reflect.apply(nativePrepare, this, [sql]) as StatementSync;
	 if (/^SELECT/u.test(sql) && /FROM native_photo_original_bindings WHERE storage_key/u.test(sql)) {
	  const nativeGet = statement.get;
	  Object.defineProperty(statement, 'get', { configurable: true, value: function (this: StatementSync, ...args: unknown[]): ReturnType<StatementSync['get']> {
	   const row = Reflect.apply(nativeGet, this, args) as ReturnType<StatementSync['get']>;
	   if (row !== undefined) receipts.push(row.content_sha256);
	   return row;
	  } });
	 }
	 return statement;
	} });
	return (): void => { if (descriptor) Object.defineProperty(database, 'prepare', descriptor); else Reflect.deleteProperty(database, 'prepare'); };
}

void test('Lightscaper native Original index rejects oversized persisted SHA before the actual SQL receipt escapes', OPTIONS, async context => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-index-sha-bound-'));
	let database: DatabaseSync | undefined, restore: (() => void) | undefined;
	try {
	 database = new DatabaseSync(join(directory, 'index.sqlite3')); const index = new Index(database); index.putBindingIfAbsent(BINDING);
	 database.exec('PRAGMA ignore_check_constraints=ON'); const receipts: unknown[] = []; restore = observeBindingReceipts(database, receipts);
	 for (const text of ['x'.repeat(8192), `${'a'.repeat(64)}\0${'x'.repeat(4096)}`, '界'.repeat(64)]) {
	  context.signal.throwIfAborted(); receipts.length = 0;
	  database.prepare('UPDATE native_photo_original_bindings SET content_sha256=? WHERE storage_key=?').run(text, BINDING.storageKey);
	  assert.throws(() => index.get(BINDING.storageKey));
	  assert.equal(receipts.length, 1, 'the real SELECT result must be witnessed');
	  assert.equal(receipts[0] === null, true, 'corrupt text must become SQL NULL before JS admission, including embedded NUL');
	 }
	} finally { restore?.(); database?.close(); await rm(directory, { recursive: true, force: true }); }
});

void test('Lightscaper native Original bounded SHA lookup retains exact valid binding and absence behavior', OPTIONS, async context => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-index-valid-sha-'));
	let database: DatabaseSync | undefined, restore: (() => void) | undefined;
	try {
	 database = new DatabaseSync(join(directory, 'index.sqlite3')); const index = new Index(database); index.putBindingIfAbsent(BINDING);
	 const receipts: unknown[] = []; restore = observeBindingReceipts(database, receipts); context.signal.throwIfAborted();
	 const result = index.get(BINDING.storageKey); assert.deepEqual(result, BINDING); assert.ok(Object.isFrozen(result));
	 assert.deepEqual(receipts, [BINDING.contentSha256]); assert.equal(index.get('absent'), null);
	} finally { restore?.(); database?.close(); await rm(directory, { recursive: true, force: true }); }
});
