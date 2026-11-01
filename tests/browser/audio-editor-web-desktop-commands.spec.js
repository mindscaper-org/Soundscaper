/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, getMenuItem, openNestedCommandMenu, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('desktop command offers on the web', () => {
	registerAudioEditorHooks();
	for (const [productId, path] of [
		['soundscaper', '/embed/en/'], ['framescaper', '/framescaper/embed/en/'],
	]) {
		test(`${productId} keeps helper settings in Preferences and labels Desktop services`, async ({ page }) => {
			const editor = await bootEditor(page, path);
			const tools = await openNestedCommandMenu(page, editor, 'Tools', []);
			await expect(getMenuItem(tools, 'Use Native Probe Helper')).toHaveCount(0);
			if (productId === 'soundscaper') {
				const services = await openNestedCommandMenu(page, editor, 'Tools', ['Desktop services']);
				await expect(getMenuItem(services, 'Use Native Probe Helper')).toHaveCount(0);
				await expect(getMenuItem(services, 'Clear Audio Helper Quarantine')).toHaveCount(0);
				await getMenuItem(services, 'MCP connection').click();
				const download = page.getByRole('dialog', { name: 'Desktop feature', exact: true });
				await expect(download).toBeVisible();
				await download.getByRole('button', { name: 'Cancel', exact: true }).click();
			} else {
				await expect(getMenuItem(tools, 'Desktop services')).toHaveCount(0);
				await page.keyboard.press('Escape');
			}
			await chooseCommandAction(page, editor, 'Edit', 'Preferences');
			const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
			await preferences.getByRole('tab', { name: /Media$/u }).click();
			await expect(preferences.getByRole('button', { name: 'Use Native Probe Helper', exact: true })).toBeVisible();
			await expect(preferences.getByRole('button', { name: 'Clear Probe Helper Quarantine', exact: true })).toBeVisible();
			await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
			await expect(preferences.getByRole('button', { name: 'Clear Audio Helper Quarantine', exact: true })).toBeVisible();
			await preferences.getByRole('tab', { name: /Effects$/u }).click();
			await preferences.getByRole('button', { name: 'Discover Native Effects', exact: true }).click();
			await expect(preferences).toBeHidden();
			await expect(page.getByRole('dialog', { name: 'Desktop feature', exact: true })).toBeVisible();
		});

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
