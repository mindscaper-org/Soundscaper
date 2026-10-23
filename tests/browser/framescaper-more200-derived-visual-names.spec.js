/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('a full-length visual preset name remains savable without changing its authored name', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	const clip = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
	await expect(clip).toBeVisible(); await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Save Visual Preset']);
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
	const name = 'A'.repeat(512);
	await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
	await dialog.getByRole('button', { name: 'Save selected generator preset', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected visual preset saved.');
	await dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true }).selectOption({ label: name });
	await expect(dialog.getByRole('button', { name: 'Apply to selected generator', exact: true })).toBeEnabled();
});
