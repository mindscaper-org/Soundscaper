/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { deriveLightscaperNativePhotoResourcePathsCurrentV1 as paths } from '../desktop/lightscaper-native-photo-resources-database-current-v1.ts';
import { openLightscaperNativePhotoResourceDatabaseCurrentV1 as openDatabase } from '../desktop/lightscaper-native-photo-resources-files-current-v1.ts';

// A real separate SQLite writer spills pages, publishes its journal, then exits
// without SQLite close/rollback. spawnSync joins that exact child before reads.
const WRITER = `import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
const database = new DatabaseSync(process.argv[1]);
database.exec('PRAGMA synchronous=FULL; PRAGMA cache_size=2; BEGIN IMMEDIATE; UPDATE foreign_bytes SET value=zeroblob(65536)');
writeFileSync(process.argv[2], 'spill-complete');
process.kill(process.pid, 'SIGKILL');`;

test('Lightscaper native resource read-only preflight preserves a genuine unowned hot journal and its spilled primary bytes', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native resource hot journal ü '))), derived = paths(directory);
	await mkdir(derived.libraryRoot, { recursive: true, mode: 0o700 });
	const database = new DatabaseSync(derived.databasePath);
	try {
		database.exec('PRAGMA journal_mode=DELETE; CREATE TABLE foreign_bytes(value BLOB)');
		const put = database.prepare('INSERT INTO foreign_bytes VALUES(randomblob(65536))');
		for (let index = 0; index < 8; index++) put.run();
	} finally { database.close(); }
	await chmod(derived.databasePath, 0o640);
	const marker = join(directory, 'writer-completed'), child = spawnSync(process.execPath,
		['--no-warnings', '--input-type=module', '-e', WRITER, derived.databasePath, marker], { timeout: 15_000, windowsHide: true });
	assert.equal(child.error, undefined); assert.equal(await readFile(marker, 'utf8'), 'spill-complete');
	assert.ok(child.signal === 'SIGKILL' || (child.status !== null && child.status !== 0), 'The actual writer must terminate without clean SQLite retirement.');
	const journalPath = derived.databasePath + '-journal', before = await readFile(derived.databasePath), journal = await readFile(journalPath);
	assert.ok(journal.length > 512); assert.deepEqual(journal.subarray(0, 8), Buffer.from('d9d505f920a163d7', 'hex'));
	const mode = (await lstat(derived.databasePath)).mode, journalMode = (await lstat(journalPath)).mode;
	await assert.rejects(openDatabase(directory));
	assert.deepEqual(await readFile(derived.databasePath), before); assert.deepEqual(await readFile(journalPath), journal);
	assert.equal((await lstat(derived.databasePath)).mode, mode); assert.equal((await lstat(journalPath)).mode, journalMode);
	await rm(directory, { recursive: true, force: false });
});
