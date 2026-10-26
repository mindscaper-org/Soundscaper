/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
type Store = ReturnType<typeof createMemoryStore>;

function waveformRenderer(controller: ReturnType<typeof createAudioEditorController>): string {
	const preferences = controller.getSnapshot().preferences as unknown as { waveformDisplay: { renderer?: string } };
	return preferences.waveformDisplay.renderer ?? 'canvas';
}

async function controllerFor(desktop: boolean, store: Store = createMemoryStore()) {
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY, locale: 'en',
		fileService: createAudioEditorFileService({ bridge: desktop ? {} : null }) as Options['fileService'],
		store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	await controller.ready;
	assert.equal(controller.getSnapshot().ready, true);
	return controller;
}

test('Electron starts with GPU waveforms and the browser starts with Canvas', async (context) => {
	for (const desktop of [true, false]) {
		const controller = await controllerFor(desktop);
		context.after(async () => { await controller.dispose(); });
		assert.equal(waveformRenderer(controller), desktop ? 'gpu' : 'canvas');
	}
});

test('Electron upgrades old preferences without a renderer choice to GPU', async (context) => {
	for (const key of ['soundscaper:audio-editor-preferences-v1', 'audio-editor-preferences-v1']) {
		const store = createMemoryStore();
		store.settings.set(key, createAudioEditorPreferencesV1({ waveformDisplay: { halfWave: true } }));
		const controller = await controllerFor(true, store);
		context.after(async () => { await controller.dispose(); });
		assert.equal(waveformRenderer(controller), 'gpu');
		const waveform = controller.getSnapshot().preferences.waveformDisplay as { readonly halfWave: boolean };
		assert.equal(waveform.halfWave, true);
	}
});

test('an explicit renderer survives updates and reloads on either platform', async (context) => {
	for (const desktop of [true, false]) for (const renderer of ['canvas', 'gpu'] as const) {
		const store = createMemoryStore();
		const controller = await controllerFor(desktop, store);
		context.after(async () => { await controller.dispose(); });
		await controller.actions.preferences.update({ waveformDisplay: { renderer } });
		await controller.actions.preferences.update({ waveformDisplay: { halfWave: true } });
		assert.equal(waveformRenderer(controller), renderer);
		await controller.dispose();
		const reloaded = await controllerFor(desktop, store);
		context.after(async () => { await reloaded.dispose(); });
		assert.equal(waveformRenderer(reloaded), renderer);
		await reloaded.actions.preferences.revertFactorySettings();
		assert.equal(waveformRenderer(reloaded), desktop ? 'gpu' : 'canvas');
	}
});

test('invalid Electron preferences recover to GPU factory defaults', async (context) => {
	const store = createMemoryStore();
	store.settings.set('soundscaper:audio-editor-preferences-v1', { schemaVersion: 1, waveformDisplay: { renderer: 'invalid' } });
	const controller = await controllerFor(true, store);
	context.after(async () => { await controller.dispose(); });
	assert.equal(waveformRenderer(controller), 'gpu');
});
