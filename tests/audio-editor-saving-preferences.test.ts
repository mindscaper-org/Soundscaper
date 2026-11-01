/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSavingPreferences, normalizeTemporaryDataPreferences } from '../src/common/editor/saving-preferences.ts';
import { createAudioEditorPreferencesV1, loadAudioEditorPreferencesV1, updateAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';

test('saving defaults differ by platform without disabling internal recovery saves', () => {
	assert.deepEqual(normalizeSavingPreferences(undefined, true), { autoSaving: false, askBeforeClosing: true });
	assert.deepEqual(normalizeSavingPreferences(), { autoSaving: true, askBeforeClosing: true });
	assert.deepEqual(normalizeTemporaryDataPreferences(), { limitProjects: true, maximumProjects: 10 });
});
test('saving and temporary preferences round trip and reject malformed limits', () => {
	const initial = createAudioEditorPreferencesV1();
	const updated = updateAudioEditorPreferencesV1(initial, { saving: { autoSaving: false }, temporaryData: { limitProjects: false, maximumProjects: 23 } });
	assert.deepEqual(updated.saving, { autoSaving: false, askBeforeClosing: true });
	assert.deepEqual(updated.temporaryData, { limitProjects: false, maximumProjects: 23 });
	for (const maximumProjects of [0, -1, 1.5, NaN, Infinity, '10']) assert.throws(() => normalizeTemporaryDataPreferences({ maximumProjects }));
	assert.throws(() => normalizeSavingPreferences({ autoSaving: 'off' }));
});

test('partial saving and temporary-data changes preserve their sibling settings', () => {
	const initial = createAudioEditorPreferencesV1({ saving: { autoSaving: false }, temporaryData: { maximumProjects: 4 } });
	const changed = updateAudioEditorPreferencesV1(initial, { saving: { askBeforeClosing: false }, temporaryData: { limitProjects: false } });
	assert.deepEqual(changed.saving, { autoSaving: false, askBeforeClosing: false });
	assert.deepEqual(changed.temporaryData, { maximumProjects: 4, limitProjects: false });
});


test('existing preferences acquire saving and temporary-data defaults when loaded', () => {
	const legacy: Record<string, unknown> = { ...createAudioEditorPreferencesV1() };
	delete legacy.saving; delete legacy.temporaryData;
	const loaded = loadAudioEditorPreferencesV1(legacy).preferences;
	assert.deepEqual(loaded.saving, { autoSaving: true, askBeforeClosing: true });
	assert.deepEqual(loaded.temporaryData, { limitProjects: true, maximumProjects: 10 });
});
