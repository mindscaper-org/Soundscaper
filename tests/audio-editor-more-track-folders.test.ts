/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MP38: selecting a folder in the previous project cannot break New Folder in the next project', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-track-folder-scope' });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'project-a' }));
	const oldFolder = controller.actions.trackFolders.create('Old folder');
	assert.equal(controller.actions.trackFolders.selectedFolderId(), oldFolder);
	await controller.actions.project.open(createSoundscaperProject({ id: 'project-b' }));
	const newFolder = controller.actions.trackFolders.create('New folder');
	const project = controller.project;
	assert.ok(project);
	assert.equal(project.trackFolders.find(({ id }) => id === newFolder)?.name, 'New folder');
	assert.equal(project.sequences.find(({ id }) => id === project.primarySequenceId)?.trackNodes
		.find(({ id }) => id === newFolder)?.parentFolderId, null);
	controller.actions.edit.undo();
	assert.equal(controller.actions.trackFolders.selectedFolderId(), null, 'undo retires a removed folder selection');
	assert.ok(controller.actions.trackFolders.create('After undo'));
});
