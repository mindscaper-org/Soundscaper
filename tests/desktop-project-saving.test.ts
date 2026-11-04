/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
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
	await mkdir(join(conflicting, 'Soundscaper', 'project-library', 'v1'), { recursive: true });
	await writeFile(join(conflicting, 'Soundscaper', 'project-library', 'v1', 'library.sqlite'), 'other data');
	await restarted.select(conflicting);
	await assert.rejects(new TemporaryProjectStorage(config, original, 'Soundscaper').prepare(), /conflict|different|identical/iu);
	assert.equal(await readFile(join(selected, 'Soundscaper', 'project-library', 'v1', 'library.sqlite'), 'utf8'), 'project data');
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
