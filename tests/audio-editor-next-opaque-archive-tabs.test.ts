/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { rewriteScapeProjectDocument } from './helpers/scape-archive-rewrite.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createAudioEditorController, createMemoryEngine, createProjectStore, COPY } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

for (const secondFuture of [false, true]) test(`NP029: a retained future archive survives another ${secondFuture ? 'future' : 'current'} project file`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const saved: Blob[] = [];
	const fileService = { isDesktop: false, chooseSaveTarget: async () => ({ browserDownload: true }),
		prepareSave: async () => ({ mode: 'blob', target: { browserDownload: true } }),
		saveFile: async ({ blob }: { blob: Blob }) => { saved.push(blob); return { fileName: 'copy.sscape', size: blob.size }; } };
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		fileService: fileService as unknown as Options['fileService'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const archive = async (id: string, future: boolean) => {
		const result = await exportScapeProject(createSoundscaperProject({ id, title: id }), store); assert.ok(result.blob instanceof Blob);
		return future ? rewriteScapeProjectDocument(result.blob, (document: { schemaVersion: number; futureOpaqueValue?: string }) => { document.schemaVersion = 2; document.futureOpaqueValue = 'Keep exact bytes'; }) : result.blob;
	};
	const first = await archive('first-opaque', true), second = await archive('second-project', secondFuture);
	await controller.actions.project.openScapeFile(new File([first], 'future.sscape'), () => 'read-only');
	assert.equal(controller.project?.id, 'first-opaque'); assert.equal(controller.getSnapshot().readOnly, true);
	await controller.actions.project.create({ title: 'Ordinary' });
	await controller.actions.project.openScapeFile(new File([second], 'second.sscape'), () => secondFuture ? 'read-only' : 'copy');
	await controller.actions.project.openById('first-opaque');
	await controller.actions.project.saveScape({ saveCopy: true, useFileSystemAccess: false });
	assert.ok(saved[0]); assert.deepEqual(new Uint8Array(await saved[0].arrayBuffer()), new Uint8Array(await first.arrayBuffer()));
	if (secondFuture) {
		await controller.actions.project.openById('second-project');
		await controller.actions.project.saveScape({ saveCopy: true, useFileSystemAccess: false });
		assert.ok(saved[1]); assert.deepEqual(new Uint8Array(await saved[1].arrayBuffer()), new Uint8Array(await second.arrayBuffer()));
	}
});
