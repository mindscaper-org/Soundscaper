/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPresetActions } from '../src/common/editor/ui/export-preset-actions.js';
import { dialogSettingsFromPreset } from '../src/common/editor/ui/export-preset-model.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createDeliveryPresetState } from '../src/common/editor/delivery-preset-store.ts';
import { DELIVERY_PRESETS_SETTING_KEY } from '../src/common/editor/controller/export/delivery-preset-service.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';

for (const action of ['same-format', 'different-format', 'save-as', 'explicit-null'] as const) test(`P015 ancillary: ${action} preset Save handles declared portable references deliberately`, async context => {
	const files: File[] = [];
	const { controller, store } = await controllerSession(context, { fileService: { ...createAudioEditorFileService(),
		async saveFile(request: Readonly<Record<string, unknown>> = {}) {
			assert.equal(request.purpose, 'preset'); assert.equal(request.mimeType, 'application/json');
			assert.equal(typeof request.text, 'string'); assert.equal(typeof request.suggestedName, 'string');
			const file = new File([String(request.text)], String(request.suggestedName), { type: 'application/json' }); files.push(file);
			return { method: 'test', fileName: file.name, size: file.size };
		},
	} });
	const presets = controller.actions.export.presets;
	const actionsFor = (presetId: string, presetName: string, settings: Record<string, unknown>) => createExportPresetActions({ controller, settings,
		presetId, presetName, presetKind: 'audio', desktop: false, projectChannelCount: 2, projectSampleRate: 48_000,
		setSettings: () => undefined, setPresetId: () => undefined, setPresetName: () => undefined });
	const initial = createExportDialogInitialSettings({ sampleRate: 48_000 });
	await actionsFor('', '', initial).onImport(new File([JSON.stringify({ schemaVersion: 1, presets: [{ schemaVersion: 1, id: 'flac-delivery', label: 'FLAC delivery', kind: 'audio', format: 'flac', settings: {},
		licensingRowId: 'flac-1-5-0-desktop-wasm', fallbackPresetId: 'wav-delivery' }, { schemaVersion: 1, id: 'wav-delivery', label: 'WAV delivery', kind: 'audio', format: 'wav', settings: {} }] })], 'lossless.json'));
	const original = presets.apply('flac-delivery'); const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), ...dialogSettingsFromPreset(original) };
	assert.equal(original.licensingRowId, 'flac-1-5-0-desktop-wasm'); assert.equal(original.fallbackPresetId, 'wav-delivery');
	await actionsFor(original.id, original.label, settings).onExport(); assert.equal(files.length, 1);
	const imported = createDeliveryPresetState(JSON.parse(await files[0]!.text())).presets[0]; assert.ok(imported);
	assert.equal(imported.licensingRowId, 'flac-1-5-0-desktop-wasm'); assert.equal(imported.fallbackPresetId, 'wav-delivery');
	if (action === 'different-format') settings.format = 'wav';
	if (action === 'explicit-null') await presets.save({ id: original.id, label: original.label, kind: 'audio', format: original.format, settings: original.settings, licensingRowId: null, fallbackPresetId: null });
	else await actionsFor(original.id, original.label, settings).onSave(action === 'save-as' ? 'New delivery' : undefined);
	const saved = action === 'save-as' ? presets.list().find(preset => preset.label === 'New delivery') : presets.apply(original.id); assert.ok(saved);
	await actionsFor(saved.id, saved.label, settings).onExport(); assert.equal(files.length, 2);
	const exported = createDeliveryPresetState(JSON.parse(await files[1]!.text())).presets[0]; assert.ok(exported);
	assert.equal(exported.licensingRowId, action === 'same-format' ? 'flac-1-5-0-desktop-wasm' : null);
	assert.equal(exported.fallbackPresetId, action === 'same-format' ? 'wav-delivery' : null);
	const durable = createDeliveryPresetState(await store.loadSetting(DELIVERY_PRESETS_SETTING_KEY)).presets.find(preset => preset.id === saved.id);
	assert.deepEqual(durable, exported, 'the file envelope retains the exact independently persisted preset');
	assert.equal(presets.apply('wav-delivery').format, 'wav');
});
