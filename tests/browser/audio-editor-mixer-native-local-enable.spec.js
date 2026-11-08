/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { installNativePluginParameterHost } from './helpers/native-plugin-parameter-host.js';

test('Mixer effect power describes its local enabled state while Plugin Manager owns native bypass', async ({ page }) => {
	await installNativePluginParameterHost(page, { allowBypass: true });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Effect', 'Plugin Manager');
	const manager = page.getByRole('dialog', { name: 'Plugin Manager', exact: true });
	await manager.getByRole('button', { name: 'Test Gain', exact: true }).click();
	await manager.locator('[data-native-plugin-instantiate="gain-install"]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.persisted)).toBe(1);
	await manager.locator('[data-native-plugin-bypass="true"]').click();
	await expect(manager.locator('[data-native-plugin-bypass="false"]')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(manager).toBeHidden();
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const mixer = editor.locator('[data-workspace-panel="mixer"]');
	await mixer.getByRole('button', { name: 'native-plugin', exact: true }).hover();
	const disable = mixer.getByRole('button', { name: 'Disable effect', exact: true });
	await expect(disable).toHaveCount(1);
	await disable.click();
	const enable = mixer.getByRole('button', { name: 'Enable effect', exact: true });
	await expect(enable).toHaveCount(1);
	await enable.click();
	await expect(disable).toHaveCount(1);
	expect(await page.evaluate(() => globalThis.__nativePluginParameterHost.bypassed)).toBe(true);
});
