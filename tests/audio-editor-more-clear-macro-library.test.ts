/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const library of ['program', 'effect', 'preset'] as const) for (const outcome of ['success', 'failure'] as const)
test(`MP57: Clear Data ${outcome} settles the pending ${library} library`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	let release: () => void = () => undefined, entered: () => void = () => undefined;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { entered = resolve; });
	context.after(async () => { release(); await controller.dispose(); }); await controller.ready;
	const key = library === 'program' ? 'audio-editor-macro-scripts-v1'
		: library === 'effect' ? 'audio-editor-effect-macros-v1' : 'audio-editor-effect-presets-v1';
	if (outcome === 'failure') store.clear = async () => { throw new Error('Storage reset refused'); };
	const put = store.saveSetting.bind(store);
	store.saveSetting = async (id, value) => { if (id === key) { entered(); await gate; } return put(id, value); };
	const save = () => library === 'program'
		? controller.actions.macros.scripts.save({ name: 'Private program', source: '/* private */' })
		: library === 'effect' ? controller.actions.macros.library.save({ name: 'Private chain', effects: [{ type: 'audacity-invert' }] })
		: controller.actions.effects.presets.save({ name: 'Private preset', effectType: 'audacity-amplify', params: { gainDb: 3 } });
	const initial = Promise.resolve(save());
	await started;
	const clear = controller.actions.project.clear();
	const completion = outcome === 'failure' ? assert.rejects(clear, /Storage reset refused/u) : clear;
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.throws(save, { name: 'InvalidStateError' }, 'queued library writes lose admission during reset');
	release(); await completion; await initial;
	await Promise.all([controller.actions.macros.scripts.flush(), controller.actions.macros.library.flush()]);
	assert.equal((await store.loadSetting(key)) === null, outcome === 'success');
	const entries = library === 'program' ? controller.actions.macros.scripts.list()
		: library === 'effect' ? controller.actions.macros.library.list() : controller.actions.effects.presets.list('audacity-amplify');
	assert.equal(entries.some(entry => entry.name.startsWith('Private')), outcome === 'failure');
});
