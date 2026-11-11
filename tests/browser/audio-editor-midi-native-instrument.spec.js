/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clickClipInterior, clipByName, chooseCommandAction, chooseNestedCommandAction, waitForEditor } from './audio-editor-test-helpers.js';
import { installNativePluginParameterHost } from './helpers/native-plugin-parameter-host.js';

test('assigns a native instrument from Plugin Manager, edits its preset and retains MIDI after reload', async ({ page }) => {
	await installNativePluginParameterHost(page, { instrument: true });
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	await panel.getByRole('button', { name: 'Add note', exact: true }).click();
	await chooseCommandAction(page, editor, 'Effect', 'Plugin Manager');
	const dialog = page.getByRole('dialog', { name: 'Plugin Manager', exact: true });
	await dialog.getByRole('button', { name: 'Test Gain', exact: true }).click();
	await dialog.locator('[data-native-plugin-instantiate="gain-install"]').click();
	await expect(panel.getByRole('combobox', { name: 'Instrument', exact: true })).toHaveValue('native');
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	const gain = dialog.locator('[data-native-plugin-parameter="gain"]');
	await expect(gain).toHaveValue('0.25');
	await gain.press('End');
	await expect(gain).toHaveValue('1');
	await dialog.locator('[data-native-plugin-persist-state]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.persisted)).toBeGreaterThan(0);
	await expect(gain).toBeEnabled();
	await dialog.locator('[data-native-plugin-close]').click();
	await page.keyboard.press('Escape');
	await panel.getByRole('button', { name: 'Add note', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload({ waitUntil: 'domcontentloaded' });
	const restored = await waitForEditor(page);
	await clickClipInterior(page, clipByName(restored, 'MIDI track (beta)'));
	if (!await restored.getByRole('combobox', { name: 'Instrument', exact: true }).isVisible()) {
		await chooseNestedCommandAction(page, restored, 'Window', ['Piano roll (beta)']);
	}
	await expect(restored.getByRole('combobox', { name: 'Instrument', exact: true })).toHaveValue('native');
	await restored.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(restored.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await restored.getByRole('button', { name: 'Stop', exact: true }).click();
	await restored.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('triangle');
	await expect(restored.getByRole('combobox', { name: 'Instrument', exact: true })).toHaveValue('triangle');
});
