/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeSoundscaperDesktopProjectLibraryDatabase } from '../desktop/soundscaper-project-library-database.ts';
import { readSoundscaperDesktopProjectRecoveryCandidates, listSoundscaperDesktopProjectRecoverySummaries } from '../desktop/soundscaper-project-recovery-reader.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { SoundscaperDesktopProjectLibraryMain } from '../desktop/soundscaper-project-library-main.ts';
import { registerSoundscaperDesktopProjectLibraryMainIpc } from '../desktop/soundscaper-project-library-main-ipc.ts';
import { createSoundscaperDesktopProjectLibraryHandshake } from '../desktop/soundscaper-project-library-contract.ts';
import { SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS } from '../desktop/soundscaper-project-library-main-channels.ts';
import { SOUNDSCAPER_PROJECT_RECOVERY_CHANNELS } from '../src/soundscaper/desktop-project-recovery-bridge.ts';

test('desktop recovery reads retained SQLite snapshots independently of missing or corrupt project files', (context) => {
	const database = new DatabaseSync(':memory:');
	context.after(() => database.close());
	initializeSoundscaperDesktopProjectLibraryDatabase(database);
	const original = createSoundscaperProject({ id: 'native-recovery', title: 'Keep my work' });
	const good = JSON.stringify(original);
	const damaged = JSON.stringify({ ...original, revision: 1, tracks: 'broken' });
	const insert = database.prepare(`INSERT INTO project_revisions
		(project_id, project_revision, project_sha256, entry_id, relative_file, byte_length, document_json, published_at_ms)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0)`);
	for (const [revision, document] of [good, damaged].entries()) {
		insert.run(original.id, revision, createHash('sha256').update(document).digest('hex'), `entry-${String(revision)}`,
			`nonexistent-${String(revision)}.json`, Buffer.byteLength(document), document);
	}
	const candidates = readSoundscaperDesktopProjectRecoveryCandidates(database, original.id);
	assert.deepEqual(candidates.map(({ revision }) => revision), [1, 0]);
	assert.equal((candidates[0]!.project as { tracks: unknown }).tracks, 'broken');
	assert.deepEqual(candidates[1]!.project, original);
	assert.deepEqual(listSoundscaperDesktopProjectRecoverySummaries(database), [{ id: original.id, title: original.title, revision: 1 }]);
	assert.equal(database.prepare('SELECT COUNT(*) AS count FROM project_revisions').get()?.count, 2);
	const current = readSoundscaperDesktopProjectRecoveryCandidates(database, original.id, 1);
	assert.deepEqual(current.map(({ kind }) => kind), ['current', 'revision']);
});

test('desktop recovery reports a malformed latest JSON without hiding the earlier usable snapshot', (context) => {
	const database = new DatabaseSync(':memory:');
	context.after(() => database.close());
	initializeSoundscaperDesktopProjectLibraryDatabase(database);
	const original = createSoundscaperProject({ id: 'native-malformed' });
	const insert = database.prepare(`INSERT INTO project_revisions
		(project_id, project_revision, project_sha256, entry_id, relative_file, byte_length, document_json, published_at_ms)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0)`);
	for (const [revision, document] of [JSON.stringify(original), '{broken'].entries()) {
		insert.run(original.id, revision, 'a'.repeat(64), `entry-${String(revision)}`, `missing-${String(revision)}.json`, document.length, document);
	}
	const candidates = readSoundscaperDesktopProjectRecoveryCandidates(database, original.id);
	assert.equal(candidates[0]!.project, null);
	assert.ok(candidates[0]!.diagnostic);
	assert.deepEqual(candidates[1]!.project, original);
	assert.ok(candidates[1]!.diagnostic?.includes('checksum'));
	assert.throws(() => readSoundscaperDesktopProjectRecoveryCandidates(database, ''));
});

test('read-only desktop recovery requires the admitted renderer owner and closes with its IPC registration', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'soundscaper-recovery-ipc-'));
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath, handshake, owner: { product: 'soundscaper', processId: 919, instanceId: 'recovery-ipc' },
		onLeaseLost: () => undefined, testControl: null,
	});
	const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
	const owner = {};
	const registration = registerSoundscaperDesktopProjectLibraryMainIpc({
		main, ownerFor: () => owner,
		handle: (channel: string, handler: (event: unknown, request?: unknown) => unknown) => { handlers.set(channel, handler); },
		removeHandler: (channel: string) => { handlers.delete(channel); },
	});
	context.after(async () => { await registration.dispose(); await main.close(); await rm(appDataPath, { recursive: true, force: true }); });
	assert.throws(() => handlers.get(SOUNDSCAPER_PROJECT_RECOVERY_CHANNELS.list)!({}), /handshake/iu);
	assert.throws(() => handlers.get(SOUNDSCAPER_PROJECT_RECOVERY_CHANNELS.read)!({}, 'absent'), /handshake/iu);
	await handlers.get(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.handshake)!({}, handshake);
	assert.deepEqual(await handlers.get(SOUNDSCAPER_PROJECT_RECOVERY_CHANNELS.list)!({}), []);
	assert.deepEqual(await handlers.get(SOUNDSCAPER_PROJECT_RECOVERY_CHANNELS.read)!({}, 'absent'), []);
	await registration.dispose();
	assert.equal(handlers.has(SOUNDSCAPER_PROJECT_RECOVERY_CHANNELS.read), false);
	assert.equal(handlers.has(SOUNDSCAPER_PROJECT_RECOVERY_CHANNELS.list), false);
});
