/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForEditor } from './audio-editor-test-helpers.js';

test('Advanced saves a compatible server, validates its URL, and restores audio.com', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences.getByLabel('Server URL', { exact: true })).toHaveCount(0);
	await preferences.getByRole('tab', { name: /Advanced$/u }).click();
	const server = preferences.getByRole('textbox', { name: 'Server URL', exact: true });
	await expect(server).toHaveValue('https://api.audio.com');
	const initialSavedServer = await savedServer(page);
	await expect(preferences.getByRole('button', { name: 'Save server', exact: true })).toBeDisabled();
	await server.fill('http://audiocity.example');
	await preferences.getByRole('button', { name: 'Save server', exact: true }).click();
	await expect(server).toHaveAttribute('aria-invalid', 'true');
	await expect(preferences.getByRole('alert')).toContainText('HTTPS server URL');
	await expect.poll(() => savedServer(page)).toBe(initialSavedServer);
	await server.fill('https://audiocity.example/');
	await server.press('Enter');
	await expect(server).toHaveValue('https://audiocity.example');
	await expect(preferences.getByRole('alert')).toHaveCount(0);
	await expect.poll(() => savedServer(page)).toBe('https://audiocity.example');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload();
	const reopenedEditor = await waitForEditor(page);
	await chooseCommandAction(page, reopenedEditor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Advanced$/u }).click();
	await expect(server).toHaveValue('https://audiocity.example');
	await preferences.getByRole('button', { name: 'Use audio.com', exact: true }).click();
	await expect(server).toHaveValue('https://api.audio.com');
	await expect.poll(() => savedServer(page)).toBe('https://api.audio.com');
});


async function savedServer(page) {
	return page.evaluate(() => new Promise((resolve, reject) => {
		const opened = globalThis.indexedDB.open('kw-media-soundscaper-editor-v1');
		opened.onerror = () => reject(opened.error);
		opened.onsuccess = () => {
			const database = opened.result;
			const stored = database.transaction('settings', 'readonly').objectStore('settings')
				.get('soundscaper:audio-editor-preferences-v1');
			stored.onerror = () => { database.close(); reject(stored.error); };
			stored.onsuccess = () => {
				const server = stored.result?.value?.advanced?.audioComServerUrl ?? null;
				database.close(); resolve(server);
			};
		};
	}));
}
