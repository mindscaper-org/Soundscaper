/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

for (const [binding, key] of [['Ctrl++', 'Control+NumpadAdd'], ['Ctrl+Shift+=', 'Control+Shift+Equal']]) {
	test(`a custom ${binding} assignment takes precedence over the default zoom alias`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
		const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
		await row.getByRole('textbox').first().fill(binding);
		await row.getByRole('button', { name: 'Assign', exact: true }).click();
		await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await editor.getByRole('button', { name: 'Undo', exact: true }).focus();
		await page.keyboard.press(key);
		await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	});
}
