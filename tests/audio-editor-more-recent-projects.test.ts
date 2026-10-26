/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { selectAudioEditorBusyBlock } from '../src/common/editor/edit-blocking.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MP42: opening a project after Clear Recent cannot lose its durable recent entry', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-recents-clear' });
	const write = store.saveSetting.bind(store);
	let armed = false, blocked = false, recentKey = '';
	let release: () => void = () => undefined, entered: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const started = new Promise<void>((resolve) => { entered = resolve; });
	store.saveSetting = async (key, value) => {
		if (armed && !blocked && key.includes('recent') && Array.isArray(value) && value.length === 0) {
			blocked = true; recentKey = key; entered(); await gate;
		}
		return write(key, value);
	};
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { release(); await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(createSoundscaperProject({ id: 'project-a' }));
	armed = true;
	const clear = controller.actions.project.clearRecent();
	await started;
	assert.equal(selectAudioEditorBusyBlock(controller.getSnapshot()).blocked, false, 'File Open remains available while Clear Recent writes settings');
	const open = controller.actions.project.open(createSoundscaperProject({ id: 'project-b' }));
	await setImmediate();
	release(); await Promise.all([open, clear]);
	assert.deepEqual(await store.loadSetting(recentKey), ['project-b']);
	assert.deepEqual(controller.getSnapshot().recentProjects.map(({ id }) => id), ['project-b']);
});
