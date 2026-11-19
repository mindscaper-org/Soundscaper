/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { FramescaperDesktopProjectLibraryMain } from '../desktop/framescaper-project-library-main.ts';
import { createFramescaperDesktopProjectLibraryHandshake,
	createFramescaperDesktopProjectLibraryPaths } from '../desktop/framescaper-project-library-contract.ts';

for (const lock of ['exclusive', 'reader'] as const) test(`Framescaper startup survives a temporary SQLite ${lock} lock`, async context => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-startup-contention-'));
	let locker: DatabaseSync | null = null;
	const release: { timer?: ReturnType<typeof setTimeout> } = {};
	context.after(async () => {
		clearTimeout(release.timer);
		if (locker?.isTransaction) locker.exec('ROLLBACK');
		locker?.close();
		await rm(root, { recursive: true, force: true });
	});
	const options = {
		appDataPath: root,
		owner: { product: 'framescaper', processId: process.pid, instanceId: 'startup-contention' },
		handshake: createFramescaperDesktopProjectLibraryHandshake(),
		onLeaseLost: () => undefined,
		testControl: { leaseTtlMs: 1_000, renewIntervalMs: 500, checkpoint: null },
	};
	const seed = await FramescaperDesktopProjectLibraryMain.start(options);
	await seed.close();
	locker = new DatabaseSync(createFramescaperDesktopProjectLibraryPaths(root).databasePath);
	// A reader permits DDL to begin but blocks COMMIT, so retries must roll back
	// that partially completed initialization before trying again.
	locker.exec(lock === 'exclusive' ? 'BEGIN EXCLUSIVE' : 'BEGIN; SELECT * FROM library_identity');
	release.timer = setTimeout(() => { locker?.exec('ROLLBACK'); }, 200);
	const main = await FramescaperDesktopProjectLibraryMain.start(options);
	try {
		assert.equal(main.snapshot().closed, false);
		assert.equal(main.snapshot().writer.tookOverStaleLease, false);
	} finally { await main.close(); }
});

test('Framescaper startup reports a live writer after transient SQLite contention', async context => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-live-writer-'));
	let holder: FramescaperDesktopProjectLibraryMain | null = null;
	let locker: DatabaseSync | null = null;
	const release: { timer?: ReturnType<typeof setTimeout> } = {};
	context.after(async () => {
		clearTimeout(release.timer);
		if (locker?.isTransaction) locker.exec('ROLLBACK');
		locker?.close();
		await holder?.close();
		await rm(root, { recursive: true, force: true });
	});
	const options = {
		appDataPath: root,
		owner: { product: 'framescaper', processId: process.pid, instanceId: 'startup-holder' },
		handshake: createFramescaperDesktopProjectLibraryHandshake(),
		onLeaseLost: () => undefined,
		testControl: { leaseTtlMs: 1_000, renewIntervalMs: 500, checkpoint: null },
	};
	holder = await FramescaperDesktopProjectLibraryMain.start(options);
	locker = new DatabaseSync(createFramescaperDesktopProjectLibraryPaths(root).databasePath);
	locker.exec('BEGIN EXCLUSIVE');
	release.timer = setTimeout(() => { locker?.exec('ROLLBACK'); }, 200);
	await assert.rejects(
		FramescaperDesktopProjectLibraryMain.start({ ...options, owner: { ...options.owner, instanceId: 'startup-contender' } }),
		/^Error: Framescaper desktop 1\.0 writer lease is busy$/u,
	);
	assert.equal(holder.snapshot().fenced, false);
});
