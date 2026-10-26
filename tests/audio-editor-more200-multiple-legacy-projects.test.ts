/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { partitionWorkspaceFiles } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const reverse of [false, true]) test(`a dropped legacy project batch reports ambiguity before publication, reverse=${String(reverse)}`, async context => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const before = controller.project; const inventory = await store.listProjects();
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const second = new File([await projectFile.arrayBuffer()], 'Another-project.aup', { type: projectFile.type });
	const selected = reverse ? [second, projectFile, dataFile] : [projectFile, second, dataFile];
	const routed = partitionWorkspaceFiles(selected); assert.equal(routed.projects.length, 0); assert.equal(routed.media.length, 3);
	await assert.rejects(controller.actions.project.importFiles(routed.media), /one legacy Audacity project/iu);
	assert.equal(controller.project, before); assert.deepEqual(await store.listProjects(), inventory);
	assert.deepEqual(await store.listSources(), []); assert.equal(controller.getSnapshot().importing, false);
	await controller.actions.project.importFiles([projectFile, dataFile]);
	assert.notEqual(controller.project?.id, before?.id); assert.equal(controller.project?.clips.length, 1);
	const source = controller.project?.sources[0]; assert.ok(source);
	const chunk = await store.readSourceChunk(String(source.storageKey), 0); assert.ok(chunk);
	assert.equal(chunk.frames, 4800); assert.equal(chunk.channels[0]?.[0], .25);
});
