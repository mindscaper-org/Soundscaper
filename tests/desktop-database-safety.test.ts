/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, linkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { openLocalDesktopDatabase } from '../desktop/desktop-database.ts';
import { initializeSoundscaperDesktopProjectLibraryDatabase } from '../desktop/soundscaper-project-library-database.ts';
import { SoundscaperDesktopProjectLibraryCatalog } from '../desktop/soundscaper-project-library-catalog.ts';
import { createSoundscaperDesktopProjectLibraryHandshake } from '../desktop/soundscaper-project-library-contract.ts';
import { emptySoundscaperDesktopLibraryMetadata } from '../desktop/soundscaper-project-library-metadata.ts';
import { initializeSoundscaperDeliveryDatabase } from '../desktop/soundscaper-delivery-database.ts';
import { initializeFramescaperNativeServicesDatabaseV3 } from '../desktop/native-services-database-v3.ts';
import { initializeFramescaperDesktopProjectLibraryLifecycleDatabase } from '../desktop/framescaper-project-library-database.ts';

function fixture(t: test.TestContext): string {
	const root = mkdtempSync(join(tmpdir(), 'scape-database-safety-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return join(root, 'library.sqlite3');
}

function catalog(database: DatabaseSync): SoundscaperDesktopProjectLibraryCatalog {
	initializeSoundscaperDesktopProjectLibraryDatabase(database);
	const result = SoundscaperDesktopProjectLibraryCatalog.create({
		database, owner: { product: 'soundscaper', processId: process.pid, instanceId: 'wal-audit-instance' },
	});
	result.acceptHandshake(createSoundscaperDesktopProjectLibraryHandshake());
	return result;
}

function publish(value: SoundscaperDesktopProjectLibraryCatalog, revision: number): void {
	const lease = value.acquireLease({ ttlMs: 30_000 });
	value.publishMetadata({ expectedRevision: revision - 1, lease,
		metadata: { ...emptySoundscaperDesktopLibraryMetadata(), revision } });
	assert.equal(value.releaseLease(lease), true);
}

test('restored legacy WAL cannot silently roll the validated catalog back', t => {
	const path = fixture(t);
	// Reproduce a sync provider retaining a WAL from the previous implementation.
	let database = new DatabaseSync(path);
	const value = catalog(database);
	database.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
	publish(value, 1);
	const oldWal = readFileSync(`${path}-wal`);
	publish(value, 2);
	database.close();
	database = openLocalDesktopDatabase(path);
	assert.equal(catalog(database).readMetadata().revision, 2);
	database.close();
	const latestMain = readFileSync(path);
	writeFileSync(`${path}-wal`, oldWal);
	assert.throws(() => openLocalDesktopDatabase(path), /WAL|sidecar/iu);
	assert.deepEqual(readFileSync(path), latestMain);
	assert.deepEqual(readFileSync(`${path}-wal`), oldWal);
});

for (const [name, initialize] of [
	['Soundscaper library', initializeSoundscaperDesktopProjectLibraryDatabase],
	['Framescaper library', initializeFramescaperDesktopProjectLibraryLifecycleDatabase],
	['delivery queue', initializeSoundscaperDeliveryDatabase],
	['native services', initializeFramescaperNativeServicesDatabaseV3],
] as const) {
	test(`${name} commits without WAL sidecars and reopens its data`, t => {
		const path = fixture(t);
		const database = openLocalDesktopDatabase(path);
		try {
			initialize(database);
			assert.equal(database.prepare('PRAGMA journal_mode').get()?.journal_mode, 'delete');
			assert.equal(database.prepare('PRAGMA synchronous').get()?.synchronous, 2);
			database.exec("CREATE TABLE safety_probe(value TEXT); INSERT INTO safety_probe VALUES ('committed');");
			assert.equal(existsSync(`${path}-wal`), false);
			assert.equal(existsSync(`${path}-shm`), false);
		} finally { database.close(); }
		const reopened = openLocalDesktopDatabase(path);
		try { assert.equal(reopened.prepare('SELECT value FROM safety_probe').get()?.value, 'committed'); }
		finally { reopened.close(); }
	});
}

test('checkpointed legacy WAL-mode database upgrades without losing committed data', t => {
	const path = fixture(t);
	const legacy = new DatabaseSync(path);
	legacy.exec("PRAGMA journal_mode = WAL; CREATE TABLE probe(value); INSERT INTO probe VALUES ('saved');");
	legacy.close();
	const database = openLocalDesktopDatabase(path);
	try {
		initializeSoundscaperDesktopProjectLibraryDatabase(database);
		assert.equal(database.prepare('SELECT value FROM probe').get()?.value, 'saved');
		assert.equal(database.prepare('PRAGMA journal_mode').get()?.journal_mode, 'delete');
	} finally { database.close(); }
});

for (const suffix of ['-wal', '-shm']) {
	test(`an unpaired ${suffix} is preserved before SQLite can create a database`, t => {
		const path = fixture(t);
		writeFileSync(`${path}${suffix}`, 'unexamined recovery evidence');
		assert.throws(() => openLocalDesktopDatabase(path), /WAL|sidecar/iu);
		assert.equal(existsSync(path), false);
		assert.equal(readFileSync(`${path}${suffix}`, 'utf8'), 'unexamined recovery evidence');
	});
}

test('linked database names cannot bypass sidecar checks under another filename', t => {
	const path = fixture(t), alias = `${path}.alias`;
	writeFileSync(path, 'original evidence');
	// File symlinks require extra privileges on Windows; hard links do not.
	if (process.platform !== 'win32') {
		symlinkSync(path, alias);
		assert.throws(() => openLocalDesktopDatabase(alias), /regular file/u);
		rmSync(alias);
	}
	linkSync(path, alias);
	assert.throws(() => openLocalDesktopDatabase(alias), /single filesystem name/u);
	assert.equal(readFileSync(path, 'utf8'), 'original evidence');
});

test('an interrupted rollback-journal transaction recovers its last committed data', t => {
	const path = fixture(t);
	const database = openLocalDesktopDatabase(path);
	initializeSoundscaperDesktopProjectLibraryDatabase(database);
	database.exec("CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES ('saved');");
	database.close();
	const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', `
		import { DatabaseSync } from 'node:sqlite';
		const database = new DatabaseSync(process.argv[1]);
		database.exec("PRAGMA cache_size = 1; BEGIN IMMEDIATE; UPDATE probe SET value = zeroblob(100000);");
		process.kill(process.pid, 'SIGKILL');
	`, path], { timeout: 10_000 });
	assert.ifError(crashed.error);
	assert.equal(crashed.status === 0, false);
	assert.equal(existsSync(`${path}-journal`), true);
	const recovered = openLocalDesktopDatabase(path);
	try {
		initializeSoundscaperDesktopProjectLibraryDatabase(recovered);
		assert.equal(recovered.prepare('SELECT value FROM probe').get()?.value, 'saved');
		assert.equal(recovered.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
	} finally { recovered.close(); }
});
