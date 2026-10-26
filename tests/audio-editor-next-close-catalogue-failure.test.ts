/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
test('NP050: a catalogue refresh failure cannot undo publication of a completed tab close', async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const list = store.listProjects.bind(store);
	let readsBeforeFailure = 0;
	const failure = new Error('Project catalogue is temporarily unavailable.');
	Object.defineProperty(store, 'listProjects', { value: async () => {
		if (readsBeforeFailure > 0 && --readsBeforeFailure === 0) throw failure;
		return list();
	} });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.rename('First');
	const firstId = controller.project?.id; assert.ok(firstId);
	await controller.actions.project.create({ title: 'Second' });
	const secondId = controller.project?.id; assert.ok(secondId);
	readsBeforeFailure = 2; // Activation lists once; the post-close refresh is the second read.
	const closed: unknown = await controller.actions.project.close();
	assert.ok(closed && typeof closed === 'object' && 'closed' in closed && closed.closed === true);
	assert.equal(controller.project?.id, firstId);
	const tabs: unknown = controller.getSnapshot().projectTabs;
	assert.ok(Array.isArray(tabs));
	assert.deepEqual(tabs.map((value: unknown) => {
		assert.ok(value && typeof value === 'object' && 'id' in value);
		return value.id;
	}), [firstId], 'the closed tab must disappear from the actual published UI snapshot');
	assert.ok(await store.loadProject(secondId), 'closing a tab preserves its saved document');
	await controller.actions.project.openById(secondId);
	assert.equal(controller.project?.id, secondId, 'the closed document can be opened normally again');
});
