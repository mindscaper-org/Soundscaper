/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, lstat, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { deriveLightscaperNativePhotoSettingsPathsCurrentV1 as paths } from '../desktop/lightscaper-native-photo-settings-database-current-v1.ts';
import { openLightscaperNativePhotoSettingsDatabaseCurrentV1 as openDatabase } from '../desktop/lightscaper-native-photo-settings-files-current-v1.ts';

async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native settings files ü ')));
	await run(directory); await rm(directory, { recursive: true, force: false });
}
async function layout(root: string): Promise<ReturnType<typeof paths>> {
	const value = paths(root); await mkdir(value.libraryRoot, { recursive: true, mode: 0o700 }); return value;
}
async function foreignDatabase(path: string): Promise<Buffer> {
	const db = new DatabaseSync(path);
	try { db.exec("CREATE TABLE foreign_bytes(value TEXT); INSERT INTO foreign_bytes VALUES('do not modify')"); }
	finally { db.close(); }
	await chmod(path, 0o640); return readFile(path);
}
const exists = async (path: string) => lstat(path).then(() => true, (error: unknown) => {
	if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false; throw error;
});

test('Lightscaper native settings opener independently creates only its private product scope and reopens genuine SQLite', async () => {
	await fixture(async directory => {
		const derived = paths(directory), db = await openDatabase(directory);
		try {
			assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
			assert.equal(db.prepare('PRAGMA synchronous').get()?.synchronous, 2); assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
			assert.deepEqual(await readdir(derived.libraryRoot).then(entries => entries.filter(name => !name.startsWith('native-photo-settings.sqlite3')).sort()), []);
			if (process.platform !== 'win32') {
				for (const path of [join(directory, 'Lightscaper'), join(directory, 'Lightscaper', 'project-library'), derived.libraryRoot]) assert.equal((await lstat(path)).mode & 0o777, 0o700);
				assert.equal((await lstat(derived.databasePath)).mode & 0o777, 0o600);
			}
			db.prepare('INSERT INTO native_photo_settings VALUES(?,?,?)').run('anchor', Uint8Array.of(0, 97), Uint8Array.of(1, 2, 3));
			for (const suffix of ['-wal', '-shm']) {
				const entry = await lstat(derived.databasePath + suffix); assert.ok(entry.isFile()); assert.equal(entry.nlink, 1);
				if (process.platform !== 'win32') assert.equal(entry.mode & 0o777, 0o600);
			}
		} finally { db.close(); }
		const reopened = await openDatabase(directory);
		try { assert.deepEqual(reopened.prepare('SELECT payload FROM native_photo_settings').get()?.payload, Uint8Array.of(1, 2, 3)); }
		finally { reopened.close(); }
	});
});

test('Lightscaper native settings opener refuses a missing or noncanonical appData root before product creation', async () => {
	await fixture(async directory => {
		const missing = join(directory, 'missing'); await assert.rejects(openDatabase(missing)); assert.equal(await exists(missing), false);
		await assert.rejects(openDatabase(`${directory}/./`)); await assert.rejects(openDatabase('relative'));
		assert.deepEqual(await readdir(directory), []);
	});
});

test('Lightscaper native settings opener refuses an appData alias without touching the actual target', async () => {
	await fixture(async directory => {
		const actual = join(directory, 'actual'), alias = join(directory, 'alias'); await mkdir(actual);
		await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
		await assert.rejects(openDatabase(alias)); assert.deepEqual(await readdir(actual), []); assert.ok((await lstat(alias)).isSymbolicLink());
	});
});

for (const location of ['Lightscaper', 'project-library', 'v1'] as const) test(`Lightscaper native settings opener refuses a linked ${location} directory and preserves foreign contents and mode`, async () => {
	await fixture(async directory => {
		const actualRoot = join(directory, 'app-data'), foreign = join(directory, 'foreign'); await mkdir(actualRoot); await mkdir(foreign, { mode: 0o750 });
		const sentinel = join(foreign, 'foreign.bin'); await writeFile(sentinel, Uint8Array.of(7, 8, 9)); const mode = (await lstat(foreign)).mode;
		const target = location === 'Lightscaper' ? join(actualRoot, location) : location === 'project-library'
			? join(actualRoot, 'Lightscaper', location) : paths(actualRoot).libraryRoot;
		await mkdir(dirname(target), { recursive: true }); await symlink(foreign, target, process.platform === 'win32' ? 'junction' : 'dir');
		await assert.rejects(openDatabase(actualRoot)); assert.deepEqual(await readFile(sentinel), Buffer.from([7, 8, 9]));
		assert.deepEqual(await readdir(foreign), ['foreign.bin']); assert.equal((await lstat(foreign)).mode, mode);
	});
});

for (const kind of ['symlink', 'hardlink'] as const) test(`Lightscaper native settings opener refuses a ${kind} database without changing foreign SQLite bytes or mode`, async () => {
	await fixture(async directory => {
		const app = join(directory, 'app-data'); await mkdir(app); const derived = await layout(app), foreign = join(directory, 'foreign.sqlite3');
		const before = await foreignDatabase(foreign), mode = (await lstat(foreign)).mode;
		if (kind === 'symlink') await symlink(foreign, derived.databasePath, 'file'); else await link(foreign, derived.databasePath);
		await assert.rejects(openDatabase(app)); assert.deepEqual(await readFile(foreign), before); assert.equal((await lstat(foreign)).mode, mode);
		assert.equal(await exists(derived.databasePath), true);
	});
});

for (const suffix of ['-wal', '-shm', '-journal']) for (const kind of ['symlink', 'hardlink'] as const) {
	test(`Lightscaper native settings opener refuses ${kind} ${suffix} before creating a database`, async () => {
		await fixture(async directory => {
			const app = join(directory, 'app-data'); await mkdir(app); const derived = await layout(app), foreign = join(directory, 'foreign-sidecar.bin');
			const bytes = Buffer.from('foreign sidecar bytes'); await writeFile(foreign, bytes, { mode: 0o640 }); const mode = (await lstat(foreign)).mode;
			if (kind === 'symlink') await symlink(foreign, derived.databasePath + suffix, 'file'); else await link(foreign, derived.databasePath + suffix);
			await assert.rejects(openDatabase(app)); assert.equal(await exists(derived.databasePath), false);
			assert.deepEqual(await readFile(foreign), bytes); assert.equal((await lstat(foreign)).mode, mode);
		});
	});
}

for (const suffix of ['-wal', '-shm', '-journal']) test(`Lightscaper native settings opener preserves an orphan regular ${suffix} and refuses absent primary authority`, async () => {
	await fixture(async directory => {
		const derived = await layout(directory), sidecar = derived.databasePath + suffix, bytes = Buffer.from('unowned orphan');
		await writeFile(sidecar, bytes, { mode: 0o640 }); const mode = (await lstat(sidecar)).mode;
		await assert.rejects(openDatabase(directory)); assert.equal(await exists(derived.databasePath), false);
		assert.deepEqual(await readFile(sidecar), bytes); assert.equal((await lstat(sidecar)).mode, mode);
	});
});

test('Lightscaper native settings opener refuses a directory at the database file path without recursive cleanup', async () => {
	await fixture(async directory => {
		const derived = await layout(directory); await mkdir(derived.databasePath); await writeFile(join(derived.databasePath, 'foreign'), 'keep');
		await assert.rejects(openDatabase(directory)); assert.equal(await readFile(join(derived.databasePath, 'foreign'), 'utf8'), 'keep');
	});
});

test('Lightscaper native settings opener authenticates an existing foreign schema before chmod or WAL mutation', async () => {
	await fixture(async directory => {
		const derived = await layout(directory), before = await foreignDatabase(derived.databasePath), mode = (await lstat(derived.databasePath)).mode;
		await assert.rejects(openDatabase(directory)); assert.deepEqual(await readFile(derived.databasePath), before);
		assert.equal((await lstat(derived.databasePath)).mode, mode); assert.deepEqual(await readdir(derived.libraryRoot), ['native-photo-settings.sqlite3']);
	});
});

test('Lightscaper native settings opener preserves an actual schema refusal and native database cleanup failure independently', async () => {
	await fixture(async directory => {
		const derived = await layout(directory), before = await foreignDatabase(derived.databasePath), original = DatabaseSync.prototype.close;
		const cleanup = new Error('Injected after actual native close'); let retired = 0;
		DatabaseSync.prototype.close = function (): void { Reflect.apply(original, this, []); retired++; throw cleanup; };
		try {
			let failure: unknown; try { await openDatabase(directory); } catch (error) { failure = error; }
			assert.ok(failure instanceof AggregateError); assert.equal(failure.errors.length, 2); assert.equal(failure.errors[1], cleanup);
			assert.notEqual(failure.errors[0], cleanup); assert.equal(retired, 1);
		} finally { DatabaseSync.prototype.close = original; }
		assert.deepEqual(await readFile(derived.databasePath), before);
	});
});
