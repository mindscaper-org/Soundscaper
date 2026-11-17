/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreferencesComposition } from '../src/common/editor/controller/preferences/preferences-composition.ts';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';

test('managed presets reset selected preferences on each launch and permit session changes', async () => {
	let saved = createAudioEditorPreferencesV1({ appearance: { theme: 'light', defaultView: 'spectrogram' } });
	let lastLaunch = '';
	for (let launch = 0; launch < 2; launch++) {
		const state = { preferences: createAudioEditorPreferencesV1(), preferencesReadOnly: false, timelineView: 'waveform' };
		const composition = createPreferencesComposition({ productId: 'soundscaper', defaultWorkspace: 'modern', isDesktop: true,
			state, lifetime: new EditorControllerLifetime(), copy: { preferencesNewerSchema: 'newer', shortcutActionRequired: 'required', shortcutConflict: 'conflict' },
			loadSetting: async key => key.endsWith(':managed-preference-launch') ? lastLaunch : saved,
			persistSetting: async (key, value) => { if (key.endsWith(':managed-preference-launch')) lastLaunch = String(value); else saved = value as typeof saved; }, publish: () => {},
			loadManagedPreferences: async () => ({ launchId: String(launch), preferences: { appearance: { theme: 'dark' } } }),
		});
		await composition.load();
		assert.equal(state.preferences.appearance.theme, 'dark');
		assert.equal(state.preferences.appearance.defaultView, 'spectrogram');
		assert.equal(state.timelineView, 'spectrogram');
		await composition.service.update({ appearance: { theme: 'light' } });
		assert.equal(state.preferences.appearance.theme, 'light');
		await composition.load();
		assert.equal(state.preferences.appearance.theme, 'light', 'renderer reload during the same launch preserves session changes');
	}
});

test('managed nested patches retain saved panel geometry and unrelated shortcuts', async () => {
	const saved = createAudioEditorPreferencesV1();
	saved.workspace.panels.analysis.dock = 'floating';
	saved.workspace.panels.analysis.width = 1234;
	saved.workspace.panels.analysis.x = 432;
	const previousShortcuts = structuredClone(saved.shortcuts);
	const state = { preferences: createAudioEditorPreferencesV1(), preferencesReadOnly: false, timelineView: 'waveform' };
	const composition = createPreferencesComposition({ productId: 'soundscaper', defaultWorkspace: 'modern', isDesktop: true,
		state, lifetime: new EditorControllerLifetime(), copy: { preferencesNewerSchema: 'newer', shortcutActionRequired: 'required', shortcutConflict: 'conflict' },
		loadSetting: async key => key.endsWith(':managed-preference-launch') ? null : saved,
		persistSetting: async () => {}, publish: () => {},
		loadManagedPreferences: async () => ({ launchId: 'launch', preferences: {
			workspace: { panels: { analysis: { visible: true } } }, shortcuts: { 'split-tool': ['Ctrl+Alt+C'] },
		} }),
	});
	await composition.load();
	assert.equal(state.preferences.workspace.panels.analysis.dock, 'floating');
	assert.equal(state.preferences.workspace.panels.analysis.width, 1234);
	assert.equal(state.preferences.workspace.panels.analysis.x, 432);
	assert.deepEqual(state.preferences.shortcuts, { ...previousShortcuts, 'split-tool': ['Ctrl+Alt+C'] });
});
