/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { COPY, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
const { createAudioEditorController } = await import('../src/common/editor/app.js');
type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

test('desktop controller saves an opened Scape to its original and asks only about later file changes', async t => {
	const memory = createMemoryStore();
	const store = Object.assign(memory, { async deleteProjectIfCurrent(project: { id: string }) { return memory.projects.delete(project.id); } }), decisions: string[] = [], targets: unknown[] = [], prompts: unknown[] = [];
	const original = { id: 'a'.repeat(48), name: 'original.sscape' };
	const fileService = createAudioEditorFileService({ bridge: {
		prepareOriginalOverwrite: async (id: string) => { targets.push(id); return { id: 'b'.repeat(48), name: original.name }; },
		confirmProjectSave: async (request: unknown) => { prompts.push(request); return decisions.shift() ?? 'cancel'; },
		rememberProjectFile: async () => undefined, restoreProjectFile: async () => null, releaseOriginalFile: async () => true,
		beginWrite: async () => ({ writeId: 'write', chunkSize: 1024 }),
		writeChunk: async (request: { offset: number; bytes: Uint8Array }) => ({ nextOffset: request.offset + request.bytes.length }),
		finishWrite: async () => ({ byteLength: 4 }),
	} });
	const controller = createAudioEditorController(null, { headless: true, copy: COPY, locale: 'en', store: store as unknown as Options['store'], engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], fileService, scapeProjectRuntime: {
			importScapeProject: async () => {
				const project = { ...structuredClone(controller.project!), id: 'imported-project', title: 'Imported project' };
				await store.saveProject(project);
				return { project, manifest: {}, readOnly: false, collision: 'copy' };
			},
			exportScapeProject: async (_project: unknown, _store: unknown, options: { createWritable?: (size: number) => Promise<WritableStream<Uint8Array>> }) => {
				if (options.createWritable) { const writable = await options.createWritable(4); const writer = writable.getWriter(); await writer.write(new Uint8Array(4)); await writer.close(); return { blob: null, manifest: {}, byteLength: 4 }; }
				return { blob: new Blob(['data']), manifest: {}, byteLength: 4 };
			},
		} });
	t.after(() => controller.dispose());
	await controller.ready;
	assert.equal(controller.getSnapshot().preferences.saving?.autoSaving, false);
	assert.equal(await controller.actions.project.prepareClose(), true, 'a fresh empty project does not prompt');
	assert.equal(prompts.length, 0);
	const file = new File(['archive'], original.name); registerDesktopOriginalFile(file, original);
	await controller.actions.project.openScape(file);
	assert.equal(await controller.actions.project.prepareClose(), true);
	await controller.actions.project.rename('Edited project');
	await controller.actions.project.flush();
	decisions.push('cancel'); assert.equal(await controller.actions.project.prepareClose(), false);
	assert.equal(prompts.length, 1);
	await controller.actions.project.save(); assert.deepEqual(targets, [], 'internal publication does not write a project file');
	await controller.actions.project.saveFile(); assert.deepEqual(targets, [original.id]);
	assert.equal(await controller.actions.project.prepareClose(), true);
	assert.equal(prompts.length, 1);
	await controller.actions.project.rename('Discarded edit');
	await controller.actions.project.flush();
	decisions.push('discard');
	assert.equal(await controller.actions.project.prepareClose(), true);
	assert.equal(store.projects.has('imported-project'), false);
	assert.deepEqual(targets, [original.id], 'discard leaves the original file untouched');
});
