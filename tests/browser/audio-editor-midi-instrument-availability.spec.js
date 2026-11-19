/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installNativePluginParameterHost } from './helpers/native-plugin-parameter-host.js';

test('allowing and revoking an instrument updates the already-open piano-roll selector', async ({ page }) => {
	page.setDefaultTimeout(10000);
	await installNativePluginParameterHost(page, { instrument: true, allowRegistryEdits: true, initiallyAllowed: false });
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const instrument = editor.getByRole('combobox', { name: 'Instrument', exact: true });
	await expect(instrument.locator('option[value="native:gain-install"]')).toHaveCount(0);
	for (const allowed of [true, false]) {
		await instrument.selectOption('native:settings');
		const dialog = page.getByRole('dialog', { name: 'Instrument settings', exact: true });
		await dialog.getByRole('button', { name: 'Test Gain', exact: true }).click();
		await dialog.locator(`[data-native-plugin-allowance="${allowed ? 'allow' : 'revoke'}"]`).click();
		await expect(dialog.locator(`[data-native-plugin-allowance="${allowed ? 'revoke' : 'allow'}"]`)).toBeEnabled();
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(instrument.locator('option[value="native:gain-install"]')).toHaveCount(allowed ? 1 : 0);
	}
});
