/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPresetActions } from '../src/common/editor/ui/export-preset-actions.js';
import { dialogSettingsFromPreset } from '../src/common/editor/ui/export-preset-model.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createDeliveryPresetState } from '../src/common/editor/delivery-preset-store.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const action of ['same-format', 'different-format', 'save-as', 'explicit-null'] as const) test(`P015 ancillary: ${action} preset Save handles declared portable references deliberately`, async context => {
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready; const presets = controller.actions.export.presets;
	await presets.import(JSON.stringify({ schemaVersion: 1, presets: [{ schemaVersion: 1, id: 'flac-delivery', label: 'FLAC delivery', kind: 'audio', format: 'flac', settings: {},
		licensingRowId: 'flac-1-5-0-desktop-wasm', fallbackPresetId: 'wav-delivery' }, { schemaVersion: 1, id: 'wav-delivery', label: 'WAV delivery', kind: 'audio', format: 'wav', settings: {} }] }));
	const original = presets.apply('flac-delivery'); const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), ...dialogSettingsFromPreset(original) };
	if (action === 'different-format') settings.format = 'wav';
	if (action === 'explicit-null') await presets.save({ id: original.id, label: original.label, kind: 'audio', format: original.format, settings: original.settings, licensingRowId: null, fallbackPresetId: null });
	else {
		const actions = createExportPresetActions({ controller, settings, presetId: original.id, presetName: original.label, presetKind: 'audio', desktop: false, projectChannelCount: 2,
			projectSampleRate: 48_000, setSettings: () => undefined, setPresetId: () => undefined, setPresetName: () => undefined });
		await actions.onSave(action === 'save-as' ? 'New delivery' : undefined);
	}
	const saved = action === 'save-as' ? presets.list().find(preset => preset.label === 'New delivery') : presets.apply(original.id); assert.ok(saved);
	const exported = createDeliveryPresetState(JSON.parse(presets.export(saved.id))).presets[0]; assert.ok(exported);
	assert.equal(exported.licensingRowId, action === 'same-format' ? original.licensingRowId : null);
	assert.equal(exported.fallbackPresetId, action === 'same-format' ? original.fallbackPresetId : null);
	assert.equal(presets.apply('wav-delivery').format, 'wav');
});
