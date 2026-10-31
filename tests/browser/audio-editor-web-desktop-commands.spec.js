/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('desktop command offers on the web', () => {
	registerAudioEditorHooks();
	for (const [productId, path] of [
		['soundscaper', '/embed/en/'], ['framescaper', '/framescaper/embed/en/'],
	]) {
		test(`${productId} offers desktop commands with a monitor and a dismissible download dialog`, async ({ page }) => {
			const editor = await bootEditor(page, path);
			await page.evaluate(() => {
				globalThis.__desktopDownloadUrl = null;
				globalThis.open = (url) => { globalThis.__desktopDownloadUrl = url; return null; };
			});
			const tools = editor.getByRole('menubar', { name: 'Application menu' })
				.getByRole('menuitem', { name: 'Tools', exact: true });
			await tools.click();
			const models = page.getByRole('menuitem', { name: 'Model Manager', exact: true });
			await expect(models).toBeEnabled();
			await expect(models.locator('.musescore-icon')).toHaveText('\uF35E');
			await models.click();
			const dialog = page.getByRole('dialog', { name: 'Desktop feature' });
			await expect(dialog).toBeVisible();
			await expect(dialog).toContainText('This feature is not in the web version. Download the desktop version to use it.');
			await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(dialog).toBeHidden();
			await expect(tools).toBeFocused();
			expect(await page.evaluate(() => globalThis.__desktopDownloadUrl)).toBeNull();

			await chooseCommandAction(page, editor, 'Generate', 'Text to Speech');
			await expect(dialog).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(dialog).toBeHidden();

			await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Enhance Dialogue']);
			await expect(dialog).toBeVisible();
			await dialog.getByRole('button', { name: 'Download', exact: true }).click();
			await expect.poll(() => page.evaluate(() => globalThis.__desktopDownloadUrl))
				.toBe(`https://${productId}.org/download/`);
			await expect(dialog).toBeHidden();

			await chooseCommandAction(page, editor, 'Effect', productId === 'soundscaper' ? 'Audio Plugins' : 'Plugin Manager');
			await expect(dialog).toBeVisible();
			if (productId === 'framescaper') {
				await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
				await chooseCommandAction(page, editor, 'Window', 'Web VCR');
				await expect(dialog).toBeVisible();
			}
		});
	}
});
