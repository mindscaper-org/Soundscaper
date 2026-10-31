/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Catalog } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { deriveLightscaperNativeCatalogPathsCurrentV1 as paths } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';

// A real joined child spills a hot journal, then exits without SQLite close.
// Fixed-size digest diagnostics must never render the changed large buffers.
const WRITER = `import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
const database = new DatabaseSync(process.argv[1]);
database.exec('PRAGMA synchronous=FULL; PRAGMA cache_size=2; BEGIN IMMEDIATE; UPDATE foreign_bytes SET value=zeroblob(65536)');
writeFileSync(process.argv[2], 'spill-complete');
process.kill(process.pid, 'SIGKILL');`;

async function snapshot(path: string) {
	const bytes = await readFile(path);
	return { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, mode: (await lstat(path)).mode };
}

test('Lightscaper actual Catalog owner refuses foreign hot-journal recovery before writable catalog adoption', { timeout: 30_000 }, async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper catalog hot journal '))), p = paths(directory);
	let owner: Catalog | undefined, failed = false, primary: unknown, readersRetired = true;
	try {
		await mkdir(p.libraryRoot, { recursive: true, mode: 0o700 });
		const db = new DatabaseSync(p.databasePath);
		try {
			db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE foreign_bytes(value BLOB)');
			const insert = db.prepare('INSERT INTO foreign_bytes VALUES(randomblob(65536))'); for (let index = 0; index < 8; index++) insert.run();
		} finally { db.close(); }
		await chmod(p.databasePath, 0o640); const marker = join(directory, 'writer-joined');
		const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', WRITER, p.databasePath, marker], { timeout: 15_000, windowsHide: true });
		assert.equal(child.error, undefined); assert.equal(await readFile(marker, 'utf8'), 'spill-complete');
		assert.ok(child.signal === 'SIGKILL' || (child.status !== null && child.status !== 0));
		const journalPath = p.databasePath + '-journal', journal = await readFile(journalPath);
		assert.ok(journal.length > 512); assert.equal(journal.subarray(0, 8).toString('hex'), 'd9d505f920a163d7');
		const before = await snapshot(p.databasePath), journalBefore = await snapshot(journalPath); let refused = false;
		try { owner = await Catalog.open({ appDataPath: directory }); }
		catch (error) { refused = true; if (error instanceof AggregateError) readersRetired = false; }
		assert.equal(refused, true, 'The actual Catalog owner must refuse the unowned database.');
		const after = await snapshot(p.databasePath), journalAfter = await snapshot(journalPath);
		assert.equal(after.sha256, before.sha256, 'Foreign primary digest changed.'); assert.equal(after.byteLength, before.byteLength);
		assert.equal(journalAfter.sha256, journalBefore.sha256, 'Foreign hot-journal digest changed.'); assert.equal(journalAfter.byteLength, journalBefore.byteLength);
		assert.equal(after.mode, before.mode); assert.equal(journalAfter.mode, journalBefore.mode);
	} catch (error) { failed = true; primary = error; }
	const cleanup: unknown[] = [];
	if (owner) { try { await owner.close(); } catch (error) { readersRetired = false; cleanup.push(error); } }
	if (readersRetired) { try { await rm(directory, { recursive: true, force: false }); } catch (error) { cleanup.push(error); } }
	else cleanup.push(new Error('Catalog retirement was not proved; hot-journal diagnostics retained.'));
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Catalog hot-journal test cleanup failed.');
	if (failed) throw primary;
});
