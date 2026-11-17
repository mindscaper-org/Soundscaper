/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OriginalFileOverwriteStore } from '../desktop/original-file-overwrite.ts';
import { exactOriginalFileIdentity } from '../desktop/original-file-identity.ts';
import { ProjectFileAssociations } from '../desktop/project-file-associations.ts';
import { TemporaryProjectStorage } from '../desktop/temporary-project-storage.ts';

test('failed association persistence does not poison restoration of committed entries', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-association-recovery-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const originalPath = join(root, 'project.sscape');
	await writeFile(originalPath, 'project');
	const identity = exactOriginalFileIdentity(await lstat(originalPath, { bigint: true }));
	const originals = new OriginalFileOverwriteStore({
		reads: { resolveOriginalFileGrant: async () => ({ path: originalPath, identity }) },
		targets: { registerPath: () => { throw new Error('No overwrite requested'); } },
		acceptsFile: () => false, cleanDisplayName: value => value, maximumCount: 10,
	});
	context.after(() => originals.dispose());
	const owner = {};
	const original = await originals.registerRead('read', { owner });
	assert.ok(original);
	const path = join(root, 'associations.json');
	const files = new ProjectFileAssociations(path, originals);
	await files.remember('saved', original.id, 'a'.repeat(64), owner);
	await rm(path);
	await mkdir(path);
	await assert.rejects(files.remember('failed', original.id, 'b'.repeat(64), owner));
	await rm(path, { recursive: true });
	assert.equal((await files.restore('saved', owner))?.originalFile?.name, 'project.sscape');
	assert.equal(await files.restore('failed', owner), null);
});

test('temporary storage rejects nested relocation before persisting an unusable launch choice', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-storage-relocation-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const active = join(root, 'active');
	const library = join(active, 'Soundscaper', 'project-library', 'v1');
	await mkdir(library, { recursive: true });
	const path = join(root, 'settings.json');
	const storage = new TemporaryProjectStorage(path, active, 'Soundscaper');
	await storage.prepare();
	await assert.rejects(storage.select(join(library, 'nested')), /overlap|nested/iu);
	assert.equal(storage.status().restartRequired, false);
	await assert.rejects(readFile(path), { code: 'ENOENT' });
	assert.equal(await new TemporaryProjectStorage(path, active, 'Soundscaper').prepare(), active);
});
