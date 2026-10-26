/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForEditor } from './audio-editor-test-helpers.js';

for (const filename of ['   .txt', '.txt']) test(`a valid macro file with an empty display stem imports as Untitled macro: ${JSON.stringify(filename)}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const choosing = page.waitForEvent('filechooser');
	await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await choosing).setFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from('Invert:\n') });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Untitled macro');
	await expect(manager.getByRole('alert')).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
		const opened = indexedDB.open('kw-media-soundscaper-editor-v1');
		opened.onerror = () => reject(opened.error);
		opened.onsuccess = () => {
			const database = opened.result;
			const request = database.transaction('settings', 'readonly').objectStore('settings').get('audio-editor-effect-macros-v1');
			request.onerror = () => { database.close(); reject(request.error); };
			request.onsuccess = () => { database.close(); resolve(request.result?.value?.macros.some(macro =>
				macro.name === 'Untitled macro' && macro.effects[0]?.type === 'audacity-invert')); };
		};
	}))).toBe(true);
	await page.reload();
	await chooseCommandAction(page, await waitForEditor(page), 'Tools', 'Macros palette');
	await expect(page.getByRole('dialog', { name: 'Macros palette', exact: true })
		.locator('[data-macro-list]').getByRole('button', { name: 'Untitled macro', exact: true })).toBeVisible();
});
