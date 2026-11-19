/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeOriginalStoreCurrentV1 as Originals } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths } from '../desktop/lightscaper-native-original-index-current-v1.ts';

// This module deliberately imports only existing production entrypoints. Root
// can establish behavioral RED before adding the new media opener module.
test('Lightscaper Original owner refuses foreign SQLite before preparing Original body/staging directories', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-original-preflight-'))), p = paths(directory);
	await mkdir(p.libraryRoot, { recursive: true }); const db = new DatabaseSync(p.databasePath);
	try { db.exec("CREATE TABLE foreign_bytes(value TEXT); INSERT INTO foreign_bytes VALUES('keep')"); } finally { db.close(); }
	await chmod(p.databasePath, 0o640); const before = await readFile(p.databasePath), mode = (await lstat(p.databasePath)).mode;
	await assert.rejects(Originals.open({ appDataPath: directory }));
	assert.deepEqual(await readFile(p.databasePath), before); assert.equal((await lstat(p.databasePath)).mode, mode);
	assert.deepEqual(await readdir(p.libraryRoot), ['native-photo-originals.sqlite3']);
	await rm(directory, { recursive: true, force: false });
});

const WRITER = `import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
const database = new DatabaseSync(process.argv[1]);
database.exec('PRAGMA synchronous=FULL; PRAGMA cache_size=2; BEGIN IMMEDIATE; UPDATE foreign_bytes SET value=zeroblob(65536)');
writeFileSync(process.argv[2], 'spill-complete');
process.kill(process.pid, 'SIGKILL');`;

test('Lightscaper Original owner readonly preflight preserves actual foreign hot-journal bytes and mode without writable recovery', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-original-hot-journal-'))), p = paths(directory);
	await mkdir(p.libraryRoot, { recursive: true }); const db = new DatabaseSync(p.databasePath);
	try { db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE foreign_bytes(value BLOB)');
		const insert = db.prepare('INSERT INTO foreign_bytes VALUES(randomblob(65536))'); for (let index = 0; index < 8; index++) insert.run(); }
	finally { db.close(); }
	await chmod(p.databasePath, 0o640); const marker = join(directory, 'writer-joined');
	const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', WRITER, p.databasePath, marker], { timeout: 15_000, windowsHide: true });
	assert.equal(child.error, undefined); assert.equal(await readFile(marker, 'utf8'), 'spill-complete');
	assert.ok(child.signal === 'SIGKILL' || (child.status !== null && child.status !== 0));
	const journalPath = p.databasePath + '-journal', before = await readFile(p.databasePath), journal = await readFile(journalPath);
	assert.ok(journal.length > 512); assert.deepEqual(journal.subarray(0, 8), Buffer.from('d9d505f920a163d7', 'hex'));
	const mode = (await lstat(p.databasePath)).mode, journalMode = (await lstat(journalPath)).mode;
	await assert.rejects(Originals.open({ appDataPath: directory }));
	assert.deepEqual(await readFile(p.databasePath), before); assert.deepEqual(await readFile(journalPath), journal);
	assert.equal((await lstat(p.databasePath)).mode, mode); assert.equal((await lstat(journalPath)).mode, journalMode);
	assert.deepEqual((await readdir(p.libraryRoot)).sort(), ['native-photo-originals.sqlite3', 'native-photo-originals.sqlite3-journal']);
	await rm(directory, { recursive: true, force: false });
});
