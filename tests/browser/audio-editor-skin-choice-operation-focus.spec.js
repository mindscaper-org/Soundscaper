/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('keyboard skin adoption keeps focus for the next carousel choice', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Appearance$/u }).click();
	const techno = preferences.getByRole('button', { name: 'Techno', exact: true });
	await techno.focus(); await techno.press('Enter');
	await expect(editor).toHaveAttribute('data-editor-skin', 'techno');
	await expect(techno).toBeEnabled();
	await expect(techno).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await expect(preferences.getByRole('button', { name: 'Lilac', exact: true })).toBeFocused();
	await expect(editor).toHaveAttribute('data-editor-skin', 'techno');
});
