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
import { createSoundscaperDesktopProjectLibraryHandshake } from '../desktop/soundscaper-project-library-contract.ts';

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
	assert.deepEqual(listSoundscaperDesktopProjectRecoverySummaries(database), [
		{ id: original.id, title: 'Damaged project', revision: 1 },
	]);
	assert.throws(() => readSoundscaperDesktopProjectRecoveryCandidates(database, ''));
});

test('desktop recovery lists only the latest document of each project and inspects every retained revision', context => {
	const database = new DatabaseSync(':memory:');
	context.after(() => database.close());
	initializeSoundscaperDesktopProjectLibraryDatabase(database);
	const insert = database.prepare(`INSERT INTO project_revisions
		(project_id, project_revision, project_sha256, entry_id, relative_file, byte_length, document_json, published_at_ms)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0)`);
	const ids = ['interview-one', 'interview-two'];
	const documents = new Map<string, { id: string; title: string; revision: number }>();
	for (const id of ids) {
		const original = createSoundscaperProject({ id });
		for (const revision of [1, 2, 3]) {
			const title = `${id} cut ${String(revision)}`;
			const document = JSON.stringify({ ...original, title, revision });
			documents.set(document, { id, title, revision });
			insert.run(id, revision, createHash('sha256').update(document).digest('hex'), id,
				`${id}-${String(revision)}.json`, Buffer.byteLength(document), document);
		}
	}
	const parse = JSON.parse;
	const parsed: unknown[] = [];
	const observer = context.mock.method(JSON, 'parse', (document: string, reviver?: Parameters<typeof parse>[1]): unknown => {
		const summary = documents.get(document);
		if (summary) parsed.push(summary);
		return parse(document, reviver);
	});
	const latest = ids.map(id => ({ id, title: `${id} cut 3`, revision: 3 }));
	try {
		assert.deepEqual(listSoundscaperDesktopProjectRecoverySummaries(database), latest);
		assert.deepEqual(parsed, latest, 'listing should decode exactly one saved document per project');
	} finally { observer.mock.restore(); }
	const inspected = readSoundscaperDesktopProjectRecoveryCandidates(database, ids[0]!, 3);
	assert.deepEqual(inspected.map(({ revision, kind, diagnostic }) => [revision, kind, diagnostic]), [
		[3, 'current', undefined], [2, 'revision', undefined], [1, 'revision', undefined],
	]);
});

test('the retained desktop reader closes with its owning library', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'soundscaper-recovery-library-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath, handshake, owner: { product: 'soundscaper', processId: 919, instanceId: 'recovery-library' },
		onLeaseLost: () => undefined, testControl: null,
	});
	try {
		assert.deepEqual(main.listProjectRecoverySummaries(), []);
		assert.deepEqual(main.readProjectRecoveryCandidates('absent'), []);
	} finally { await main.close(); }
	assert.throws(() => main.listProjectRecoverySummaries(), /closed/iu);
	assert.throws(() => main.readProjectRecoveryCandidates('absent'), /closed/iu);
});
