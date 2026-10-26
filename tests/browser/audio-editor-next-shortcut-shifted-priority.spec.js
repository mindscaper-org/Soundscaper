/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const [binding, chord] of [['Shift+<', 'Shift+Comma'], ['Shift+>', 'Shift+Period']]) {
	test(`a saved ${binding} preference invokes its command before an older physical-key alias`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
		const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
		await row.getByRole('textbox').first().fill(binding);
		await row.getByRole('button', { name: 'Assign', exact: true }).click();
		await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
		await editor.getByRole('button', { name: 'Undo', exact: true }).focus();
		await page.keyboard.press(chord);
		await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	});
}
