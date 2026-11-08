/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createTakeFitProject } from './helpers/take-fit-project.ts';

test('Fit project includes unflattened take content after ordinary clip material', async t => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createMemoryStore();
	const project = createTakeFitProject();
	const controller = createAudioEditorController(null, { headless: true, projectRuntime,
		sessionController: projectRuntime.createSessionController(), locale: 'en', copy: COPY,
		store: store as unknown as Options['store'], engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	t.after(async () => { await controller.dispose(); });
	await controller.ready;
	await store.saveProject(project);
	await controller.actions.project.open(project);
	controller.actions.timeline.setViewportWidth(960);
	assert.equal(controller.actions.timeline.zoomFit(960), 80, 'the complete 12-second editable content fits the viewport');
});
