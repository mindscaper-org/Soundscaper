/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPresetActions } from '../src/common/editor/ui/export-preset-actions.js';
import { dialogSettingsFromPreset, presetSettingsFromDialog, previewPresetSettingsFromDialog, previewPresetSettingsFromPreset } from '../src/common/editor/ui/export-preset-model.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { validateDeliveryPreset } from '../src/common/editor/delivery-preset.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const headphones of [false, true]) test(`actual Export preset save/file/reimport retains the portable headphone mode=${String(headphones)}`, async context => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), channelMapping: 'mono', binaural: headphones,
		adm: { mode: 'authored', objects: [{ id: 'project-local-object', trackId: 'project-local-track' }] } };
	const actions = createExportPresetActions({ controller, settings, presetId: '', presetName: '', presetKind: 'audio',
		desktop: false, projectChannelCount: 2, projectSampleRate: 48_000, setSettings: () => undefined,
		setPresetId: () => undefined, setPresetName: () => undefined });
	await actions.onSave('Delivery');
	const saved = controller.actions.export.presets.list()[0]; assert.ok(saved);
	const file = controller.actions.export.presets.export(saved.id);
	await controller.actions.export.presets.delete(saved.id); await controller.actions.export.presets.import(file);
	const restored = controller.actions.export.presets.apply(saved.id);
	const fresh = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), ...dialogSettingsFromPreset(restored) };
	assert.equal(fresh.binaural, headphones);
	assert.equal(fresh.channelMapping, 'mono');
	assert.equal(restored.settings.binaural === true, headphones);
	assert.equal(Object.hasOwn(restored.settings, 'adm'), false);
	assert.equal(file.includes('project-local-'), false);
	if (!headphones) assert.equal(Object.hasOwn(restored.settings, 'binaural'), false, 'ordinary files stay compatible with older readers');
});

test('changing only headphones marks a saved audio preset as edited', () => {
	const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), binaural: true };
	const preset = validateDeliveryPreset({ schemaVersion: 1, id: 'headphones', label: 'Headphones', kind: 'audio', format: 'wav',
		settings: presetSettingsFromDialog(settings, 'audio') });
	assert.notDeepEqual(previewPresetSettingsFromDialog({ ...settings, binaural: false }, 'audio'), previewPresetSettingsFromPreset(preset));
});

test('a legacy ordinary preset resets an active headphones draft to ordinary delivery', () => {
	const preset = validateDeliveryPreset({ schemaVersion: 1, id: 'legacy', label: 'Legacy mono', kind: 'audio', format: 'wav', settings: { channelMapping: 'mono' } });
	const applied: Readonly<Record<string, unknown>> = { binaural: true, ...dialogSettingsFromPreset(preset) };
	assert.equal(applied.binaural, false); assert.equal(applied.channelMapping, 'mono');
});


test('portable headphone files admit only the declared boolean and keep video settings closed', () => {
	const preset = { schemaVersion: 1, id: 'portable', label: 'Portable', kind: 'audio', format: 'wav' };
	for (const binaural of [null, 'true', 1, {}]) {
		assert.throws(() => validateDeliveryPreset({ ...preset, settings: { binaural } }), /binaural.*boolean/u);
	}
	assert.equal(validateDeliveryPreset({ ...preset, settings: { binaural: false } }).settings.binaural, false);
	assert.throws(() => validateDeliveryPreset({ ...preset, kind: 'video', format: 'mp4', settings: { binaural: true } }), /Unknown video delivery setting/u);
});
