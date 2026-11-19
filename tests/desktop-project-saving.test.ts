/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, mkdir, readFile, writeFile, rm, rename, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemporaryProjectStorage } from '../desktop/temporary-project-storage.ts';
import { ProjectFileAssociations } from '../desktop/project-file-associations.ts';
import { OriginalFileOverwriteStore } from '../desktop/original-file-overwrite.ts';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';
import { acceptsFile } from '../desktop/validation.js';
import { registerProjectSavingIpc } from '../desktop/project-saving-main-ipc.ts';

const owner = {};
test('temporary folder changes move the closed library on restart and preserve conflicts', async t => {
	const root = await mkdtemp(join(tmpdir(), 'scape-temporary-data-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = join(root, 'settings.json'), original = join(root, 'default'), selected = join(root, 'chosen');
	const source = join(original, 'Soundscaper', 'project-library', 'v1');
	await mkdir(source, { recursive: true }); await writeFile(join(source, 'library.sqlite'), 'project data');
	const storage = new TemporaryProjectStorage(config, original, 'Soundscaper');
	assert.equal(await storage.prepare(), original);
	assert.deepEqual(await storage.select(selected), { folder: original, selectedFolder: selected, restartRequired: true });
	assert.equal(await readFile(join(source, 'library.sqlite'), 'utf8'), 'project data');
	const restarted = new TemporaryProjectStorage(config, original, 'Soundscaper');
	assert.equal(await restarted.prepare(), selected);
	assert.equal(await readFile(join(selected, 'Soundscaper', 'project-library', 'v1', 'library.sqlite'), 'utf8'), 'project data');
	assert.equal(restarted.status().restartRequired, false);
	const conflicting = join(root, 'conflicting');
	const conflictingLibrary = join(conflicting, 'Soundscaper', 'project-library', 'v1');
	await mkdir(conflictingLibrary, { recursive: true });
	await writeFile(join(conflictingLibrary, 'library.sqlite'), 'other data');
	await assert.rejects(restarted.select(conflicting), /conflict|different|identical/iu);
	assert.deepEqual(restarted.status(), { folder: selected, selectedFolder: selected, restartRequired: false });
	assert.equal(await new TemporaryProjectStorage(config, original, 'Soundscaper').prepare(), selected);
	assert.equal(await readFile(join(selected, 'Soundscaper', 'project-library', 'v1', 'library.sqlite'), 'utf8'), 'project data');
	assert.equal(await readFile(join(conflictingLibrary, 'library.sqlite'), 'utf8'), 'other data');
});

test('a missing pending temporary folder leaves the active library in place until it returns', async t => {
	const root = await mkdtemp(join(tmpdir(), 'scape-temporary-folder-missing-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = join(root, 'settings.json'), original = join(root, 'default'), selected = join(root, 'chosen');
	const libraryPath = join('Soundscaper', 'project-library', 'v1');
	await mkdir(join(original, libraryPath), { recursive: true });
	await writeFile(join(original, libraryPath, 'library.sqlite'), 'working project data');
	await new TemporaryProjectStorage(config, original, 'Soundscaper').select(selected);
	const unavailable = join(root, 'unavailable');
	await rename(selected, unavailable);

	const restarted = new TemporaryProjectStorage(config, original, 'Soundscaper');
	assert.equal(await restarted.prepare(), original);
	assert.deepEqual(restarted.status(), { folder: original, selectedFolder: selected, restartRequired: true });
	assert.equal(await readFile(join(original, libraryPath, 'library.sqlite'), 'utf8'), 'working project data');
	await assert.rejects(stat(selected), { code: 'ENOENT' });

	await rename(unavailable, selected);
	assert.equal(await new TemporaryProjectStorage(config, original, 'Soundscaper').prepare(), selected);
	assert.equal(await readFile(join(selected, libraryPath, 'library.sqlite'), 'utf8'), 'working project data');
});

test('a fresh temporary folder selection can be deferred before any library exists', async t => {
	const root = await mkdtemp(join(tmpdir(), 'scape-temporary-folder-fresh-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = join(root, 'settings.json'), original = join(root, 'default'), selected = join(root, 'chosen');
	const unavailable = join(root, 'disconnected');
	await new TemporaryProjectStorage(config, original, 'Soundscaper').select(selected);
	await rename(selected, unavailable);
	assert.equal(await new TemporaryProjectStorage(config, original, 'Soundscaper').prepare(), original);
	assert.deepEqual(JSON.parse(await readFile(config, 'utf8')), { active: original, selected, moveStarted: false });
	await rename(unavailable, selected);
	assert.equal(await new TemporaryProjectStorage(config, original, 'Soundscaper').prepare(), selected);
	assert.deepEqual(JSON.parse(await readFile(config, 'utf8')), { active: selected, selected, moveStarted: false });
});

for (const moveStarted of [true, undefined]) test(`a disconnected destination cannot reopen a split project library (${moveStarted ?? 'legacy'})`, async t => {
	const root = await mkdtemp(join(tmpdir(), 'scape-temporary-folder-split-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = join(root, 'settings.json'), original = join(root, 'default'), selected = join(root, 'chosen');
	const libraryPath = join('Soundscaper', 'project-library', 'v1');
	const source = join(original, libraryPath), destination = join(selected, libraryPath);
	await mkdir(source, { recursive: true });
	await mkdir(destination, { recursive: true });
	await writeFile(join(source, 'unmoved.media'), 'project audio');
	await writeFile(join(source, 'library.sqlite'), 'project catalog');
	await rename(join(source, 'library.sqlite'), join(destination, 'library.sqlite'));
	await writeFile(config, JSON.stringify({ active: original, selected, moveStarted }));
	const unavailable = join(root, 'disconnected');
	await rename(selected, unavailable);

	await assert.rejects(new TemporaryProjectStorage(config, original, 'Soundscaper').prepare(), /reconnect/iu);
	await assert.rejects(stat(join(source, 'library.sqlite')), { code: 'ENOENT' });
	assert.equal(await readFile(join(source, 'unmoved.media'), 'utf8'), 'project audio');
	assert.equal(await readFile(join(unavailable, libraryPath, 'library.sqlite'), 'utf8'), 'project catalog');

	await rename(unavailable, selected);
	assert.equal(await new TemporaryProjectStorage(config, original, 'Soundscaper').prepare(), selected);
	assert.equal(await readFile(join(destination, 'library.sqlite'), 'utf8'), 'project catalog');
	assert.equal(await readFile(join(destination, 'unmoved.media'), 'utf8'), 'project audio');
});

test('starting a move records it before the destination can refuse filesystem writes', {
	skip: process.platform === 'win32' || process.getuid?.() === 0,
}, async t => {
	const root = await mkdtemp(join(tmpdir(), 'scape-temporary-folder-write-refusal-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = join(root, 'settings.json'), original = join(root, 'default'), selected = join(root, 'chosen');
	const libraryPath = join('Soundscaper', 'project-library', 'v1');
	const source = join(original, libraryPath);
	await mkdir(source, { recursive: true });
	await writeFile(join(source, 'library.sqlite'), 'project catalog');
	await new TemporaryProjectStorage(config, original, 'Soundscaper').select(selected);
	assert.deepEqual(JSON.parse(await readFile(config, 'utf8')), { active: original, selected, moveStarted: false });

	await chmod(selected, 0o500);
	try {
		await assert.rejects(new TemporaryProjectStorage(config, original, 'Soundscaper').prepare(), /EACCES|EPERM/iu);
		assert.deepEqual(JSON.parse(await readFile(config, 'utf8')), { active: original, selected, moveStarted: true });
		assert.equal(await readFile(join(source, 'library.sqlite'), 'utf8'), 'project catalog');
	} finally { await chmod(selected, 0o700); }

	assert.equal(await new TemporaryProjectStorage(config, original, 'Soundscaper').prepare(), selected);
	assert.deepEqual(JSON.parse(await readFile(config, 'utf8')), { active: selected, selected, moveStarted: false });
	assert.equal(await readFile(join(selected, libraryPath, 'library.sqlite'), 'utf8'), 'project catalog');
});

test('a picked project destination becomes repeatable only after commit and survives restart', async t => {
	const root = await mkdtemp(join(tmpdir(), 'scape-file-associations-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const reads = new ReadCapabilityStore(), targets = new SaveTargetStore();
	const originals = new OriginalFileOverwriteStore({ reads, targets, acceptsFile, cleanDisplayName: value => value, maximumCount: 10 });
	const saves = new AtomicSaveManager({ targets } as never);
	t.after(async () => { originals.dispose(); await reads.dispose(); await saves.dispose(); });
	const path = join(root, 'project.sscape');
	const target = originals.registerProjectSave(path, { owner });
	await assert.rejects(originals.prepare(target.originalFile.id, { owner }));
	const session = await saves.begin({ targetId: target.id, owner, size: 4 });
	await saves.writeChunk({ owner, writeId: session.writeId, offset: 0, bytes: new TextEncoder().encode('data') });
	await saves.finish(session.writeId, { owner });
	const registry = new ProjectFileAssociations(join(root, 'associations.json'), originals);
	await registry.remember('project-a', target.originalFile.id, 'a'.repeat(64), owner);
	const restarted = new ProjectFileAssociations(join(root, 'associations.json'), originals); await restarted.load();
	const restored = await restarted.restore('project-a', owner);
	assert.ok(restored?.originalFile); assert.equal(restored.baseline, 'a'.repeat(64));
	assert.equal(JSON.stringify(restored).includes(root), false);
	assert.ok(await originals.prepare(restored.originalFile.id, { owner }));
	await rename(path, `${path}.old`); await writeFile(path, 'external replacement');
	assert.equal((await restarted.restore('project-a', owner))?.originalFile, null);
});

test('native close prompts map Save, Discard and Cancel and default unknown results to Cancel', async () => {
	const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
	let response = 0;
	let buttons: readonly string[] = [];
	registerProjectSavingIpc({
		handle: (name, handler) => { handlers.set(name, handler); }, ownerFor: () => owner,
		channels: Object.fromEntries(['rememberProjectFile', 'restoreProjectFile', 'temporaryDataStatus', 'chooseTemporaryDataFolder', 'confirmProjectSave'].map(name => [name, name])),
		files: {} as ProjectFileAssociations, storage: {} as TemporaryProjectStorage, chooseFolder: async () => null,
		prompt: async options => { buttons = options.buttons; assert.equal(options.cancelId, 2); return { response }; },
	});
	for (const [index, decision] of ['save', 'discard', 'cancel', 'cancel'].entries()) {
		response = index;
		assert.equal(await handlers.get('confirmProjectSave')!(null, { title: 'Save?', message: 'Save A?', save: 'Save', discard: 'Discard', cancel: 'Cancel' }), decision);
	}
	assert.deepEqual(buttons, ['Save', 'Discard', 'Cancel']);
});
