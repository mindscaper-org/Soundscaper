/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MP43: File Recent displays an open project rename immediately', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-recents-title' });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'renamed-project', title: 'Before rename' }));
	await controller.actions.project.rename('After rename');
	const recentTitle = () => controller.getSnapshot().recentProjects.find(({ id }) => id === 'renamed-project')?.title;
	assert.equal(recentTitle(), 'After rename');
	controller.actions.edit.undo();
	assert.equal(recentTitle(), 'Before rename');
	controller.actions.edit.redo();
	assert.equal(recentTitle(), 'After rename');
});
