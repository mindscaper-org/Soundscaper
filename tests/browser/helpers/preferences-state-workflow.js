/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { chooseCommandAction, chooseDropdown, waitForEditor } from '../audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './track-menu.js';

/** Keep one native input/IndexedDB/reload witness beside the Appearance workflow. */
export async function exerciseNativePreferenceCustody(page, editor) {
	await expect(page.locator('[data-desktop-speed-warmup]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences.getByRole('tab').first()).toHaveText(/General$/u);
	await expect(preferences.getByRole('tab', { name: /General$/u })).toHaveAttribute('aria-selected', 'true');
	await expect(preferences.getByRole('group', { name: 'Language', exact: true })).toBeVisible();
	await expect(preferences.getByRole('group', { name: 'Optimize for', exact: true })).toHaveCount(0);
	await expect(preferences.getByLabel('Server URL', { exact: true })).toHaveCount(0);
	await expect(preferences.getByRole('group', { name: 'Ask to save projects when closing', exact: true })).toHaveCount(0);
	const programStart = preferences.getByRole('radiogroup', { name: 'Program start', exact: true });
	await expect(programStart).toHaveAttribute('data-program-start', 'continue-last-session');
	await expect(programStart.getByRole('radio', { name: 'Continue last session', exact: true })).toBeChecked();
	await programStart.getByRole('radio', { name: 'Start with new project', exact: true }).check();
	await expect(programStart).toHaveAttribute('data-program-start', 'new-project');
	const auto = preferences.getByRole('group', { name: 'Auto-saving', exact: true });
	await expect(auto.getByRole('button')).toContainText('On');
	await chooseDropdown(page, auto, 'Off');
	await preferences.getByRole('tab', { name: /Advanced$/u }).click();
	const optimization = preferences.getByRole('group', { name: 'Optimize for', exact: true });
	await expect(optimization.getByRole('button')).toContainText('Memory');
	await expect(preferences.locator('[data-external-ffmpeg-preference="true"]')).toHaveCount(0);
	await chooseDropdown(page, optimization, 'Speed');
	await expect.poll(async () => (await savedNativePreferences(page))?.performance?.optimizeFor).toBe('speed');
	const limit = preferences.getByRole('spinbutton', { name: 'Temporary project limit', exact: true });
	await expect(limit).toHaveValue('10');
	await limit.fill('4'); await limit.press('Enter');
	await expect(limit).toHaveValue('4');
	await preferences.getByRole('checkbox', { name: 'Maximum number of temporary projects', exact: true }).click();
	await expect(limit).toBeDisabled();
	await expect(preferences.getByRole('textbox', { name: 'Temporary data folder', exact: true })).toHaveValue('Browser storage');
	const server = preferences.getByRole('textbox', { name: 'Server URL', exact: true });
	await expect(server).toHaveValue('https://api.audio.com');
	const initialSavedServer = (await savedNativePreferences(page))?.advanced?.audioComServerUrl ?? null;
	await expect(preferences.getByRole('button', { name: 'Save server', exact: true })).toBeDisabled();
	await server.fill('http://audiocity.example');
	await preferences.getByRole('button', { name: 'Save server', exact: true }).click();
	await expect(server).toHaveAttribute('aria-invalid', 'true');
	await expect(preferences.getByRole('alert')).toContainText('HTTPS server URL');
	await expect.poll(async () => (await savedNativePreferences(page))?.advanced?.audioComServerUrl ?? null).toBe(initialSavedServer);
	await server.fill('https://audiocity.example/'); await server.press('Enter');
	await expect(server).toHaveValue('https://audiocity.example');
	await expect(preferences.getByRole('alert')).toHaveCount(0);
	await expect.poll(async () => {
		const saved = await savedNativePreferences(page);
		return { startup: saved?.startup?.mode, server: saved?.advanced?.audioComServerUrl,
			autoSaving: saved?.saving?.autoSaving, limit: saved?.temporaryData };
	}).toEqual({ startup: 'new-project', server: 'https://audiocity.example', autoSaving: false,
		limit: { maximumProjects: 4, limitProjects: false } });
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload();
	const reopenedEditor = await waitForEditor(page);
	await expect(page.locator('[data-desktop-speed-warmup]')).toHaveCount(0);
	await chooseCommandAction(page, reopenedEditor, 'Edit', 'Preferences');
	await expect(programStart).toHaveAttribute('data-program-start', 'new-project');
	await expect(auto.getByRole('button')).toContainText('Off');
	await preferences.getByRole('tab', { name: /Advanced$/u }).click();
	await expect(optimization.getByRole('button')).toContainText('Speed');
	await expect(limit).toHaveValue('4'); await expect(limit).toBeDisabled();
	await expect(server).toHaveValue('https://audiocity.example');
	await preferences.getByRole('button', { name: 'Use audio.com', exact: true }).click();
	await expect(server).toHaveValue('https://api.audio.com');
	await expect.poll(async () => (await savedNativePreferences(page))?.advanced?.audioComServerUrl).toBe('https://api.audio.com');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	return reopenedEditor;
}

export async function openNativeTrackDisplayPreferences(page, editor) {
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(), ['Track visualization', 'Track display']);
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences.getByRole('tab', { name: /Track display$/u })).toHaveAttribute('aria-selected', 'true');
	await expect(preferences.getByRole('tab', { name: /^(Waveform|Spectrogram)$/u })).toHaveCount(0);
	await expect(preferences.locator('[data-spectrogram-settings]')).toBeVisible();
	await expect(preferences.getByRole('group', { name: 'Default view', exact: true })).toBeVisible();
	const settings = preferences.locator('[data-waveform-visualization-settings]');
	await expect(settings.getByRole('spinbutton', { name: 'Low/mid crossover (Hz)', exact: true })).toHaveValue('250');
	await expect(settings.getByRole('spinbutton', { name: 'Mid/high crossover (Hz)', exact: true })).toHaveValue('4000');
}

export async function exerciseNativeEffectMenuOrganization(page, editor) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: 'Effect', exact: true }).click();
	let menu = page.getByRole('menu', { name: 'Effect', exact: true });
	await expect(menu.getByRole('menuitem', { name: /^Volume and compression/u })).toBeVisible();
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Effects$/u }).click();
	await chooseDropdown(page, preferences.getByRole('group', { name: 'Effect menu organization', exact: true }), 'Sort by effect name');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(preferences).toBeHidden();
	await menubar.getByRole('menuitem', { name: 'Effect', exact: true }).click();
	menu = page.getByRole('menu', { name: 'Effect', exact: true });
	await expect(menu.getByRole('menuitem', { name: /^Volume and compression/u })).toHaveCount(0);
	const amplify = menu.getByRole('menuitem', { name: /^Amplify(?: —|$)/u });
	await expect(amplify).toBeVisible(); await expect(amplify).toBeDisabled();
	await page.keyboard.press('Escape');
}

function savedNativePreferences(page) {
	return page.evaluate(() => new Promise((resolve, reject) => {
		const opened = globalThis.indexedDB.open('kw-media-soundscaper-editor-v1');
		opened.onerror = () => reject(opened.error);
		opened.onsuccess = () => {
			const database = opened.result;
			const stored = database.transaction('settings', 'readonly').objectStore('settings').get('soundscaper:audio-editor-preferences-v1');
			stored.onerror = () => { database.close(); reject(stored.error); };
			stored.onsuccess = () => { database.close(); resolve(stored.result?.value ?? null); };
		};
	}));
}
