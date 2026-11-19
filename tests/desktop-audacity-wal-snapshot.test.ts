/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, symlink, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAudacityWalSnapshot } from '../desktop/audacity-wal-snapshot.ts';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';

test('desktop selection replays companion WAL into an owned copy, retaining all original files', async () => {
	const folder = await mkdtemp(join(tmpdir(), 'audacity-wal-test-'));
	const path = join(folder, 'recording.aup4unsaved');
	const db = new DatabaseSync(path);
	let snapshot: Awaited<ReturnType<typeof prepareAudacityWalSnapshot>>;
	try {
		db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE test(value);');
		db.exec('PRAGMA wal_checkpoint(TRUNCATE); INSERT INTO test VALUES(42)');
		const originals = await Promise.all(['', '-wal', '-shm'].map(suffix => readFile(path + suffix)));
		snapshot = await prepareAudacityWalSnapshot(path);
		assert.ok(snapshot);
		const copied = new DatabaseSync(snapshot.path, { readOnly: true });
		try { assert.equal(copied.prepare('SELECT value FROM test').get()?.value, 42); } finally { copied.close(); }
		assert.deepEqual(await Promise.all(['', '-wal', '-shm'].map(suffix => readFile(path + suffix))), originals);
		await snapshot.dispose();
		await snapshot.dispose();
		await assert.rejects(readFile(snapshot.path), { code: 'ENOENT' });
	} finally { db.close(); await rm(folder, { recursive: true, force: true }); }
});

test('desktop WAL preparation leaves standalone files alone and refuses unsafe companion symlinks', async () => {
	const folder = await mkdtemp(join(tmpdir(), 'audacity-wal-test-'));
	try {
		const path = join(folder, 'project.aup3');
		await writeFile(path, 'original');
		assert.equal(await prepareAudacityWalSnapshot(path), null);
		await symlink(path, path + '-wal');
		await assert.rejects(prepareAudacityWalSnapshot(path), /regular file/u);
		assert.deepEqual((await readdir(folder)).sort(), ['project.aup3', 'project.aup3-wal']);
	} finally { await rm(folder, { recursive: true, force: true }); }
});

test('selected-range admission owns WAL scratch and protects the original from recovery publication', async () => {
	const folder = await mkdtemp(join(tmpdir(), 'audacity-wal-test-'));
	const path = join(folder, 'project.aup3'), owner = {}, store = new ReadCapabilityStore();
	const db = new DatabaseSync(path);
	try {
		db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE test(value); INSERT INTO test VALUES(9)');
		const descriptor = await store.registerSelectedRangePath(path, { owner });
		assert.equal(descriptor.name, 'project.aup3');
		const grant = await store.resolveHelperGrant(descriptor.id, { owner });
		assert.ok(grant && grant.path !== path);
		await assert.rejects(store.assertRecoveryOutputPath(path, { owner }), /original project/u);
		await store.assertRecoveryOutputPath(join(folder, 'Recovered.aup3'), { owner });
		await store.revokeOwner(owner);
		await assert.rejects(readFile(grant.path), { code: 'ENOENT' });
		assert.ok((await readFile(path + '-wal')).length > 32);
	} finally { await store.dispose(); db.close(); await rm(folder, { recursive: true, force: true }); }
});

test('a corrupt WAL checksum is refused instead of silently losing its committed rows', async () => {
	const folder = await mkdtemp(join(tmpdir(), 'audacity-wal-test-'));
	const path = join(folder, 'project.aup4'), db = new DatabaseSync(path);
	try {
		db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE test(value); INSERT INTO test VALUES(9)');
		const wal = await readFile(path + '-wal'); wal[wal.length - 1] = wal[wal.length - 1]! ^ 1;
		await writeFile(path + '-wal', wal);
		await assert.rejects(prepareAudacityWalSnapshot(path), /checksum/u);
		assert.deepEqual(await readFile(path + '-wal'), wal);
	} finally { db.close(); await rm(folder, { recursive: true, force: true }); }
});

test('a companion WAL with a different page size is rejected before SQLite can ignore it', async () => {
	const folder = await mkdtemp(join(tmpdir(), 'audacity-wal-test-'));
	const path = join(folder, 'project.aup4'), other = join(folder, 'other.aup4');
	const source = new DatabaseSync(path);
	source.exec('CREATE TABLE original(value)'); source.close();
	const db = new DatabaseSync(other);
	try {
		db.exec('PRAGMA page_size=1024; VACUUM; PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE test(value)');
		await writeFile(path + '-wal', await readFile(other + '-wal'));
		await assert.rejects(prepareAudacityWalSnapshot(path), /page sizes do not match/u);
	} finally { db.close(); await rm(folder, { recursive: true, force: true }); }
});
