/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MP23: a failed editing macro command stops and rolls back earlier steps', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-macro-execution' }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const trackIdsBefore = controller.project?.tracks.map(({ id }) => id);
	await assert.rejects(controller.actions.macros.run({ name: 'Copy requires audio', effects: [
		createMacroCommandStep('NewMonoTrack'),
		createMacroCommandStep('Copy'),
		createMacroCommandStep('NewMonoTrack'),
	] }), /time selection/iu);
	assert.deepEqual(controller.project?.tracks.map(({ id }) => id), trackIdsBefore);
});
