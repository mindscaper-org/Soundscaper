/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAudioEditorBusyBlock } from '../src/common/editor/edit-blocking.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MP44: failed Clear Data teardown before storage mutation recovers the active document', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const engine = createMemoryEngine();
	let failStop = false, clears = 0;
	const failure = new Error('Playback cleanup failed');
	const stop = engine.stop.bind(engine), clear = store.clear.bind(store);
	engine.stop = () => { if (failStop) { failStop = false; throw failure; } stop(); };
	store.clear = async () => { clears++; return clear(); };
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: engine as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'original', title: 'My recording' }));
	failStop = true;
	await assert.rejects(controller.actions.project.clear(), error => error === failure);
	assert.equal(clears, 0, 'destructive storage clearing did not start');
	assert.equal(controller.project?.id, 'original');
	assert.equal(selectAudioEditorBusyBlock(controller.getSnapshot()).blocked, false, 'failure releases reset admission');
	await controller.actions.project.rename('Recovered recording');
	assert.equal(controller.project?.title, 'Recovered recording');
	await controller.actions.project.save();
	assert.equal((await store.loadProject('original'))?.title, 'Recovered recording');
});
