/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OriginalFileOverwriteStore } from '../desktop/original-file-overwrite.ts';
import { exactOriginalFileIdentity } from '../desktop/original-file-identity.ts';
import { ProjectFileAssociations } from '../desktop/project-file-associations.ts';
import { projectLibraryLocationDirectory } from '../desktop/project-library-directory-lock.ts';
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
	assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.tmp')), []);
	await rm(path, { recursive: true });
	assert.equal((await files.restore('saved', owner))?.originalFile?.name, 'project.sscape');
	assert.equal(await files.restore('failed', owner), null);
});

test('restoring an unassociated project returns no record even when its ID names an inherited property', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-association-project-id-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const { files, owner, originalId } = await associationFixture(root);
	await files.remember('project', originalId, 'a'.repeat(64), owner);
	assert.equal(await files.restore('toString', owner), null);
});

test('a project association survives restart with a pre-epoch modification timestamp', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-association-timestamp-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const originalPath = join(root, 'project.sscape');
	await writeFile(originalPath, 'project');
	await utimes(originalPath, new Date(0), new Date(-1000));
	if ((await lstat(originalPath, { bigint: true })).mtimeNs >= 0n) {
		context.skip('The filesystem cannot store a negative modification timestamp');
		return;
	}
	const { files, originals, owner, originalId } = await associationFixture(root, originalPath);
	const baseline = 'a'.repeat(64);
	await files.remember('project', originalId, baseline, owner);
	const restarted = new ProjectFileAssociations(files.filePath, originals);
	await restarted.load();
	const restored = await restarted.restore('project', {});
	assert.equal(restored?.baseline, baseline);
	assert.equal(restored?.originalFile?.name, 'project.sscape');
});

async function associationFixture(root: string, path?: string) {
	const originalPath = path ?? join(root, 'project.sscape');
	if (!path) await writeFile(originalPath, 'project');
	const identity = exactOriginalFileIdentity(await lstat(originalPath, { bigint: true }));
	const originals = new OriginalFileOverwriteStore({
		reads: { resolveOriginalFileGrant: async () => ({ path: originalPath, identity }) },
		targets: { registerPath: () => { throw new Error('No overwrite requested'); } },
		acceptsFile: () => false, cleanDisplayName: value => value, maximumCount: 10,
	});
	const owner = {};
	const original = await originals.registerRead('read', { owner });
	assert.ok(original);
	return { files: new ProjectFileAssociations(join(root, 'associations.json'), originals), originals, owner, originalId: original.id };
}

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

test('temporary storage refuses a directory alias that resolves inside its active library', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-storage-alias-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const active = join(root, 'active');
	const nested = join(active, 'Soundscaper', 'project-library', 'v1', 'nested');
	const alias = join(root, 'alias');
	await mkdir(nested, { recursive: true });
	await symlink(nested, alias, 'junction');
	const storage = new TemporaryProjectStorage(join(root, 'settings.json'), active, 'Soundscaper');
	await storage.prepare();
	await assert.rejects(storage.select(alias), /overlap|nested/iu);
	assert.equal(storage.status().restartRequired, false);
});

test('startup cancels a fresh destination alias without switching the active library', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-storage-pending-alias-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const active = join(root, 'active');
	const alias = join(root, 'alias');
	const library = join(active, 'Soundscaper', 'project-library', 'v1');
	const catalog = join(library, 'library.sqlite3');
	const settings = join(root, 'settings.json');
	await mkdir(library, { recursive: true });
	await writeFile(catalog, 'original catalog');
	await symlink(active, alias, 'junction');
	await writeFile(settings, JSON.stringify({ active, selected: alias, moveStarted: false }));
	const storage = new TemporaryProjectStorage(settings, active, 'Soundscaper');
	assert.equal(await storage.prepare(), active);
	assert.deepEqual(storage.status(), { folder: active, selectedFolder: active, restartRequired: false });
	assert.equal(await readFile(catalog, 'utf8'), 'original catalog');
	assert.deepEqual(JSON.parse(await readFile(settings, 'utf8')), { active, selected: active, moveStarted: false });
});

test('overlapping folder choices persist the last selection through a single writer', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-storage-select-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const active = join(root, 'active');
	const first = join(root, 'first');
	const second = join(root, 'second');
	const path = join(root, 'settings.json');
	const storage = new TemporaryProjectStorage(path, active, 'Soundscaper');
	await storage.prepare();
	await Promise.all([storage.select(first), storage.select(second)]);
	assert.equal(storage.status().selectedFolder, second);
	assert.equal(await new TemporaryProjectStorage(path, active, 'Soundscaper').prepare(), second);
});

test('restart clears a registered copy stage after the library source was retired', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-storage-relocation-receipt-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const active = join(root, 'active');
	const selected = join(root, 'selected');
	const configuration = join(root, 'settings.json');
	await new TemporaryProjectStorage(configuration, active, 'Soundscaper').select(selected);
	const settings = JSON.parse(await readFile(configuration, 'utf8')) as object;
	const destination = join(selected, 'Soundscaper', 'project-library', 'v1');
	await mkdir(destination, { recursive: true });
	const catalog = join(destination, 'library.sqlite3');
	await writeFile(catalog, 'already published');
	const copyStage = `relocation-${'a'.repeat(32)}`;
	const stage = join(projectLibraryLocationDirectory(selected, 'Soundscaper'), copyStage);
	await mkdir(stage);
	await writeFile(join(stage, 'b'.repeat(64)), 'already published');
	await writeFile(configuration, JSON.stringify({ ...settings, moveStarted: true, copyStage }));

	const restarted = new TemporaryProjectStorage(configuration, active, 'Soundscaper');
	assert.equal(await restarted.prepare(), selected);
	await assert.rejects(lstat(stage), { code: 'ENOENT' });
	assert.equal(await readFile(catalog, 'utf8'), 'already published');
	assert.equal(restarted.status().restartRequired, false);
});
