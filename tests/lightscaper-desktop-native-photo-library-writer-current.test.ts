/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { acquireLightscaperNativePhotoLibraryWriterCurrentV1 as acquire } from '../desktop/lightscaper-native-photo-library-writer-current-v1.ts';
import { openLightscaperNativePhotoLibraryDatabaseCurrentV1 as openProfile } from '../desktop/lightscaper-native-photo-library-files-current-v1.ts';
import { nativeGuardFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-photo-library-writer-fixture-current.ts';

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const TABLE = 'CREATE TABLE native_photo_library_writer_guard (singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1)) STRICT';

test('Lightscaper native writer guard owns exact empty LSLW schema, fixed parents and real WAL durability', async () => {
	await fixture(async f => {
		const guard = f.own(await acquire(f.appDataPath)); guard.assertCurrent(); assert.equal(Object.isFrozen(guard), true);
		const db = new DatabaseSync(f.databasePath, { readOnly: true });
		try {
			assert.equal(db.prepare('PRAGMA application_id').get()?.application_id, 0x4c534c57); assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 1);
			assert.deepEqual(db.prepare('SELECT name,sql FROM sqlite_schema ORDER BY name').all().map(row => ({ name: row.name, sql: row.sql })), [{ name: 'native_photo_library_writer_guard', sql: TABLE }]);
			assert.equal(db.prepare('SELECT 1 FROM native_photo_library_writer_guard LIMIT 1').get(), undefined);
			assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
		} finally { db.close(); }
		assert.ok((await readdir(f.libraryRoot)).every(name => /^native-photo-library-writer\.sqlite3(?:-wal|-shm)?$/u.test(name)));
		if (process.platform !== 'win32') { assert.equal((await lstat(f.libraryRoot)).mode & 0o777, 0o700); assert.equal((await lstat(f.databasePath)).mode & 0o777, 0o600); }
		const closing = guard.close(); assert.equal(guard.close(), closing); assert.throws(() => guard.assertCurrent()); await closing;
	});
});

test('Lightscaper actual independent Node processes refuse simultaneous writers and transfer only after release', { timeout: 30_000 }, async () => {
	await fixture(async f => {
		const holder = f.child(); assert.equal((await holder.first).status, 'held');
		const contender = f.child(), refused = await contender.first;
		assert.equal(refused.status, 'failed'); assert.match(refused.message!, /busy|writer|locked/i); assert.equal((await contender.closed).code, 1);
		holder.release(); assert.equal((await holder.closed).code, 0);
		const successor = f.child(); assert.equal((await successor.first).status, 'held'); successor.release(); assert.equal((await successor.closed).code, 0);
	});
});

test('Lightscaper actual holder termination releases the SQLite guard without TTL, PID probes or lock-file deletion', { timeout: 30_000 }, async () => {
	await fixture(async f => {
		const holder = f.child(); assert.equal((await holder.first).status, 'held'); const before = await lstat(f.databasePath, { bigint: true });
		assert.equal(holder.child.kill('SIGKILL'), true); await holder.closed;
		const successor = f.child(); assert.equal((await successor.first).status, 'held'); const after = await lstat(f.databasePath, { bigint: true });
		assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino); successor.release(); assert.equal((await successor.closed).code, 0);
	});
});

test('Lightscaper native guard refuses a second real same-process connection and releases only its own connection', async () => {
	await fixture(async f => {
		const first = f.own(await acquire(f.appDataPath)); await assert.rejects(acquire(f.appDataPath)); first.assertCurrent(); await first.close();
		const second = f.own(await acquire(f.appDataPath)); second.assertCurrent(); assert.throws(() => first.assertCurrent());
	});
});

test('Lightscaper native guard refuses foreign SQLite before permission or WAL mutation', async () => {
	await fixture(async f => {
		await mkdir(f.libraryRoot, { recursive: true }); const db = new DatabaseSync(f.databasePath);
		db.exec("PRAGMA application_id=123; PRAGMA user_version=9; CREATE TABLE foreign_data (value TEXT); INSERT INTO foreign_data VALUES('untouched')"); db.close();
		await chmod(f.databasePath, 0o640); const bytes = await readFile(f.databasePath), mode = (await lstat(f.databasePath)).mode;
		await assert.rejects(acquire(f.appDataPath)); assert.equal(digest(await readFile(f.databasePath)), digest(bytes)); assert.equal((await lstat(f.databasePath)).mode, mode);
		assert.deepEqual(await readdir(f.libraryRoot), ['native-photo-library-writer.sqlite3']);
	});
});

test('Lightscaper native guard rejects retained rows and wrong exact schema rather than adopting a lock-looking database', async () => {
	await fixture(async f => {
		const first = await acquire(f.appDataPath); await first.close(); const db = new DatabaseSync(f.databasePath);
		db.exec('INSERT INTO native_photo_library_writer_guard VALUES(1)'); db.close(); const before = await readFile(f.databasePath);
		await assert.rejects(acquire(f.appDataPath)); assert.equal(digest(await readFile(f.databasePath)), digest(before));
	});
});

for (const suffix of ['-wal', '-shm', '-journal']) test(`Lightscaper native guard refuses orphan ${suffix} without creating a primary or deleting foreign evidence`, async () => {
	await fixture(async f => {
		await mkdir(f.libraryRoot, { recursive: true }); const foreign = Uint8Array.of(3, 7, 19); await writeFile(f.databasePath + suffix, foreign);
		await assert.rejects(acquire(f.appDataPath)); assert.equal(digest(await readFile(f.databasePath + suffix)), digest(foreign));
		assert.deepEqual(await readdir(f.libraryRoot), ['native-photo-library-writer.sqlite3' + suffix]);
	});
});

test('Lightscaper native guard refuses a hard-linked primary without modifying the foreign inode', async () => {
	await fixture(async f => {
		await mkdir(f.libraryRoot, { recursive: true }); const foreign = join(f.appDataPath, 'foreign.sqlite3');
		const db = new DatabaseSync(foreign); db.exec('CREATE TABLE retained(value TEXT)'); db.close(); await link(foreign, f.databasePath);
		const before = await readFile(foreign); await assert.rejects(acquire(f.appDataPath)); assert.equal(digest(await readFile(foreign)), digest(before));
	});
});

test('Lightscaper native guard permanently fences after actual transaction loss and rejects forged or proxied handles', async () => {
	await fixture(async f => {
		const actual = DatabaseSync.prototype.exec, opened = new Set<DatabaseSync>();
		DatabaseSync.prototype.exec = function (sql: string): void { Reflect.apply(actual, this, [sql]); if (sql === 'BEGIN IMMEDIATE') opened.add(this); };
		let guard: Awaited<ReturnType<typeof acquire>>;
		try { guard = f.own(await acquire(f.appDataPath)); } finally { DatabaseSync.prototype.exec = actual; }
		const connection = [...opened].find(db => db.isOpen && db.isTransaction); assert.ok(connection); connection.exec('ROLLBACK');
		assert.throws(() => guard.assertCurrent()); connection.exec('BEGIN IMMEDIATE'); assert.throws(() => guard.assertCurrent(), 'Loss cannot be undone by a later matching native transaction.');
		const prototype = Object.getPrototypeOf(guard) as { assertCurrent(): void };
		assert.throws(() => Reflect.apply(prototype.assertCurrent, {}, [])); assert.throws(() => new Proxy(guard, {}).assertCurrent()); await guard.close();
	});
});

test('Lightscaper library secure opener accepts only its fixed trusted profile filenames', async () => {
	await fixture(async f => {
		let calls = 0;
		await assert.rejects(openProfile(f.appDataPath, { fileName: '../foreign.sqlite3', inspect() { calls++; return 'empty' as const; }, initialize() { calls++; } } as unknown as Parameters<typeof openProfile>[1]));
		assert.equal(calls, 0); assert.deepEqual(await readdir(f.appDataPath), []);
	});
});
