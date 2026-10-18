/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, lstat, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { openLightscaperNativePhotoMediaDatabaseCurrentV1 as openDatabase } from '../desktop/lightscaper-native-photo-media-files-current-v1.ts';
import { inspectLightscaperNativePhotoMediaDatabaseCurrentV1 as inspect } from '../desktop/lightscaper-native-photo-media-schema-current-v1.ts';
import { initializeHistoricalLightscaperOriginalV1Current as historical } from './helpers/lightscaper-native-original-v1-fixture-current.ts';

async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native media opener ü ')));
	await run(directory); await rm(directory, { recursive: true, force: false });
}
async function layout(directory: string) { const value = paths(directory); await mkdir(value.libraryRoot, { recursive: true, mode: 0o700 }); return value; }
const exists = (path: string) => lstat(path).then(() => true, (error: unknown) => {
	if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false; throw error;
});

test('Lightscaper managed media opener creates only product parents and exact genuine LSCP3 database with private WAL/FULL/FK', async () => {
	await fixture(async directory => {
		const p = paths(directory), db = await openDatabase(directory);
		try {
			assert.equal(inspect(db), 'owned'); assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 3);
			assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal'); assert.equal(db.prepare('PRAGMA synchronous').get()?.synchronous, 2);
			assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
			assert.equal(await exists(p.bodiesRoot), false); assert.equal(await exists(p.stagingRoot), false);
			assert.deepEqual((await readdir(p.libraryRoot)).filter(name => !name.startsWith('native-photo-originals.sqlite3')), []);
			db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('binding-only', 'a'.repeat(64), 3);
			if (process.platform !== 'win32') {
				assert.equal((await lstat(p.databasePath)).mode & 0o777, 0o600);
				for (const parent of [join(directory, 'Lightscaper'), join(directory, 'Lightscaper', 'project-library'), p.libraryRoot]) assert.equal((await lstat(parent)).mode & 0o777, 0o700);
				for (const suffix of ['-wal', '-shm']) assert.equal((await lstat(p.databasePath + suffix)).mode & 0o777, 0o600);
			}
		} finally { db.close(); }
		const reopened = await openDatabase(directory);
		try { assert.equal(inspect(reopened), 'owned'); assert.equal(reopened.prepare('SELECT byte_length FROM native_photo_original_bindings').get()?.byte_length, 3); }
		finally { reopened.close(); }
	});
});

test('Lightscaper real historical LSCP1 passes readonly preflight then atomically migrates without creating body directories or provenance', async () => {
	await fixture(async directory => {
		const p = await layout(directory), old = new DatabaseSync(p.databasePath);
		try { historical(old); old.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('old-binding', 'b'.repeat(64), 17); }
		finally { old.close(); }
		await chmod(p.databasePath, 0o640); const db = await openDatabase(directory);
		try {
			assert.equal(inspect(db), 'owned'); assert.equal(db.prepare('SELECT byte_length FROM native_photo_original_bindings WHERE storage_key=?').get('old-binding')?.byte_length, 17);
			assert.equal(db.prepare('SELECT count(*) AS n FROM native_photo_media_assets').get()?.n, 0);
			assert.equal(db.prepare('SELECT count(*) AS n FROM native_photo_media_roots').get()?.n, 0);
			assert.equal(await exists(p.bodiesRoot), false); assert.equal(await exists(p.stagingRoot), false);
		} finally { db.close(); }
	});
});

test('Lightscaper media opener refuses missing and noncanonical appData before creating product paths', async () => {
	await fixture(async directory => {
		await assert.rejects(openDatabase(join(directory, 'missing'))); await assert.rejects(openDatabase(`${directory}/./`)); await assert.rejects(openDatabase('relative'));
		assert.deepEqual(await readdir(directory), []);
	});
});

for (const extra of [false, true]) test(`Lightscaper media opener preserves ${extra ? 'owned-v1 with extra object' : 'foreign'} SQLite bytes and mode before any WAL adoption`, async () => {
	await fixture(async directory => {
		const p = await layout(directory), db = new DatabaseSync(p.databasePath);
		try { if (extra) historical(db); db.exec('CREATE TABLE foreign_bytes(value TEXT); INSERT INTO foreign_bytes VALUES(\'keep\')'); } finally { db.close(); }
		await chmod(p.databasePath, 0o640); const before = await readFile(p.databasePath), mode = (await lstat(p.databasePath)).mode;
		await assert.rejects(openDatabase(directory)); assert.deepEqual(await readFile(p.databasePath), before); assert.equal((await lstat(p.databasePath)).mode, mode);
		assert.deepEqual(await readdir(p.libraryRoot), ['native-photo-originals.sqlite3']);
	});
});

for (const kind of ['symlink', 'hardlink'] as const) test(`Lightscaper media opener rejects ${kind} primary without modifying its foreign target`, async () => {
	await fixture(async directory => {
		const p = await layout(directory), target = join(directory, 'foreign.sqlite3'), db = new DatabaseSync(target);
		try { db.exec('CREATE TABLE foreign_bytes(value TEXT)'); } finally { db.close(); }
		await chmod(target, 0o640); const before = await readFile(target), mode = (await lstat(target)).mode;
		if (kind === 'symlink') await symlink(target, p.databasePath, 'file'); else await link(target, p.databasePath);
		await assert.rejects(openDatabase(directory)); assert.deepEqual(await readFile(target), before); assert.equal((await lstat(target)).mode, mode);
		assert.equal(await exists(p.bodiesRoot), false); assert.equal(await exists(p.stagingRoot), false);
	});
});

for (const suffix of ['-wal', '-shm', '-journal']) test(`Lightscaper media opener preserves orphan ${suffix} and refuses absent primary authority`, async () => {
	await fixture(async directory => {
		const p = await layout(directory), sidecar = p.databasePath + suffix; await writeFile(sidecar, 'unowned', { mode: 0o640 });
		const bytes = await readFile(sidecar), mode = (await lstat(sidecar)).mode;
		await assert.rejects(openDatabase(directory)); assert.equal(await exists(p.databasePath), false);
		assert.deepEqual(await readFile(sidecar), bytes); assert.equal((await lstat(sidecar)).mode, mode);
	});
});

test('Lightscaper media opener refuses a linked product directory and linked sidecar without changing their targets', async () => {
	await fixture(async directory => {
		const actual = join(directory, 'actual'); await mkdir(actual); const foreign = join(directory, 'foreign'); await mkdir(foreign); await writeFile(join(foreign, 'sentinel'), 'keep');
		await symlink(foreign, join(actual, 'Lightscaper'), process.platform === 'win32' ? 'junction' : 'dir');
		await assert.rejects(openDatabase(actual)); assert.deepEqual(await readdir(foreign), ['sentinel']); assert.equal(await readFile(join(foreign, 'sentinel'), 'utf8'), 'keep');
		const clean = join(directory, 'clean'); await mkdir(clean); const p = await layout(clean), target = join(directory, 'sidecar'); await writeFile(target, 'foreign journal');
		await link(target, p.databasePath + '-journal'); await assert.rejects(openDatabase(clean));
		assert.equal(await exists(p.databasePath), false); assert.equal(await readFile(target, 'utf8'), 'foreign journal');
	});
});

test('Lightscaper media readonly-preflight preserves schema failure and observed actual database-close failure independently', async () => {
	await fixture(async directory => {
		const p = await layout(directory), db = new DatabaseSync(p.databasePath); try { db.exec('CREATE TABLE foreign_bytes(value TEXT)'); } finally { db.close(); }
		const bytes = await readFile(p.databasePath), close = DatabaseSync.prototype.close, cleanup = new Error('After actual native close'); let retired = 0;
		DatabaseSync.prototype.close = function (): void { close.call(this); retired++; throw cleanup; };
		try {
			let failure: unknown; try { await openDatabase(directory); } catch (error) { failure = error; }
			assert.ok(failure instanceof AggregateError); assert.equal(failure.errors.length, 2); assert.equal(failure.errors[1], cleanup); assert.notEqual(failure.errors[0], cleanup); assert.equal(retired, 1);
		} finally { DatabaseSync.prototype.close = close; }
		assert.deepEqual(await readFile(p.databasePath), bytes);
	});
});
