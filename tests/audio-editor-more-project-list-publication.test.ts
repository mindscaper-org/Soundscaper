/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAudioEditorBusyBlock } from '../src/common/editor/edit-blocking.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MP49: a delayed Local Projects list cannot hide a project created after the listing began', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const list = store.listProjects.bind(store);
	let armed = false, held = false;
	let release: () => void = () => undefined, entered: () => void = () => undefined;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { entered = resolve; });
	store.listProjects = async () => {
		const saved = await list();
		if (armed && !held) { held = true; entered(); await gate; }
		return saved;
	};
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { release(); await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(createSoundscaperProject({ id: 'first' }));
	armed = true; const listing = controller.actions.project.list(); await started;
	assert.equal(selectAudioEditorBusyBlock(controller.getSnapshot()).blocked, false,
		'the Local Projects dialog can be dismissed and File New remains available while its read waits');
	await controller.actions.project.create({ title: 'Created during listing' });
	const id = controller.project?.id; assert.ok(id && id !== 'first');
	assert.ok(controller.getSnapshot().projects.some(project => project.id === id));
	release(); await listing;
	assert.ok(controller.getSnapshot().projects.some(project => project.id === id));
	assert.ok(controller.getSnapshot().recentProjects.some(project => project.id === id));
});
