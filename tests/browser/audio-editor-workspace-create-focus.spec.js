/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('keyboard workspace creation keeps focus inside the open authoring form', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Workspace$/u }).click();
	const name = preferences.getByRole('textbox', { name: 'Workspace name', exact: true });
	await name.fill('Keyboard layout');
	const create = preferences.getByRole('button', { name: 'Create from current layout', exact: true });
	await create.focus();
	await create.press('Enter');
	await expect(preferences.getByRole('button', { name: 'Workspace preset', exact: true })).toHaveText(/Keyboard layout/u);
	await expect(name).toHaveValue('');
	await expect(create).toBeDisabled();
	expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
	await expect(name).toBeFocused();
});
