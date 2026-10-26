/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, waitForEditor } from './audio-editor-test-helpers.js';

test('an invalid macro edit reports its save refusal and can be corrected', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	let manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const name = manager.getByRole('textbox', { name: 'Macro name', exact: true });
	await name.fill('a'.repeat(257));
	await expect(manager.getByRole('alert')).toContainText('Macro name');
	expect(errors).toEqual([]);
	await name.fill('Corrected macro');
	await expect(manager.getByRole('alert')).toHaveCount(0);
	await page.reload();
	const reopened = await waitForEditor(page);
	await chooseCommandAction(page, reopened, 'Tools', 'Macros palette');
	manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await expect(manager.locator('[data-macro-list]').getByRole('button', { name: 'Corrected macro', exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});
