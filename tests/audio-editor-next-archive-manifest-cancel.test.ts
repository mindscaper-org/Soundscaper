/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { rewriteScapeProjectDocument } from './helpers/scape-archive-rewrite.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('NP032: File checksum export acknowledges native Cancel and permits a successful retry', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	let cancelReport = true, reportWrites = 0, offset = 0, purpose = '';
	const fileService = createAudioEditorFileService({ bridge: {
		chooseSaveTarget: async (request: { purpose: string; suggestedName: string }) => { purpose = request.purpose; return purpose === 'report' && cancelReport ? null : { id: 'target', name: request.suggestedName }; },
		beginWrite: async () => { if (purpose === 'report') reportWrites += 1; offset = 0; return { writeId: 'write' }; },
		writeChunk: async (request: { offset: number; bytes: Uint8Array }) => { offset = request.offset + request.bytes.length; return { nextOffset: offset }; },
		finishWrite: async () => ({ byteLength: offset }), abortWrite: async () => true,
	} });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(), fileService: fileService as unknown as Options['fileService'],
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const archive = await exportScapeProject(createSoundscaperProject({ id: 'future-manifest', title: 'Future' }), store);
	assert.ok(archive.blob instanceof Blob);
	const future = await rewriteScapeProjectDocument(archive.blob, (project: Record<string, unknown>) => { project.schemaVersion = 2; project.opaqueValue = 'Retain exact archive'; });
	await controller.actions.project.openScapeFile(new File([future], 'Future.sscape'), () => 'copy');
	await controller.actions.project.saveScape({ saveCopy: true });
	assert.ok(controller.getSnapshot().archiveManifest);
	await controller.actions.project.create();
	const cancelled = await controller.actions.media.saveArchiveManifest();
	assert.deepEqual(cancelled, { saved: false, reason: null });
	assert.equal(reportWrites, 0);
	cancelReport = false;
	assert.deepEqual(await controller.actions.media.saveArchiveManifest(), { saved: true, reason: null });
	assert.equal(reportWrites, 1);
});
