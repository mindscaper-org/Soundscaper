/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const fail of [false, true]) test(`MP57 ancillary: Clear Data ${fail ? 'failure retains' : 'success removes'} delivery presets after queued writes settle`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	let release = () => {}, entered = () => {};
	const gate = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { entered = resolve; });
	context.after(async () => { release(); await controller.dispose(); }); await controller.ready;
	const key = 'audio-editor-delivery-presets-v1';
	const put = store.settingsRepository.putIfAbsent.bind(store.settingsRepository);
	store.settingsRepository.putIfAbsent = async (id, value) => { if (id === key) { entered(); await gate; } return await put(id, value); };
	if (fail) store.clear = async () => { throw new Error('Reset refused'); };
	const initial = controller.actions.export.presets.save({ label: 'Private delivery', kind: 'audio', format: 'wav' });
	await started;
	const clearing = controller.actions.project.clear();
	const completion = fail ? assert.rejects(clearing, /Reset refused/u) : clearing;
	await new Promise<void>(resolve => setImmediate(resolve));
	const queued = controller.actions.export.presets.save({ label: 'Late delivery', kind: 'audio', format: 'wav' });
	const denied = assert.rejects(queued, { name: 'InvalidStateError' });
	release(); await initial; await completion; await denied;
	assert.equal((await store.loadSetting(key)) === null, !fail);
	assert.equal(controller.actions.export.presets.list().some(preset => preset.label === 'Private delivery'), fail);
	assert.equal(controller.actions.export.presets.list().some(preset => preset.label === 'Late delivery'), false);
});
