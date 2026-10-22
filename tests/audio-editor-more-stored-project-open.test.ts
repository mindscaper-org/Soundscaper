/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MP22: pending library open cannot replace a later File New project', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-stored-project-open' });
	const saved = createSoundscaperProject({ id: 'slow-library-project', title: 'Library' });
	await store.saveProject(saved);
	const originalLoad = store.loadProject.bind(store);
	let release = (): void => undefined;
	const loadGate = new Promise<void>((resolve) => { release = resolve; });
	store.loadProject = async (id: string) => {
		if (id === saved.id) await loadGate;
		return originalLoad(id);
	};
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const libraryOpen = controller.actions.project.openById(saved.id);
	await controller.actions.project.create({ title: 'Later new project' });
	const newerProjectId = controller.project?.id;
	release();
	await libraryOpen;
	assert.equal(controller.project?.id, newerProjectId);
	assert.equal(controller.project?.title, 'Later new project');
});
