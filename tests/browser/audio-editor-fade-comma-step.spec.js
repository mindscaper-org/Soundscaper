/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('an admitted decimal-comma fade length remains valid when incremented', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click({ button: 'right' });
	const parent = page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Fade in/u });
	await parent.hover();
	await parent.getByRole('menuitem', { name: 'Edit fade-in', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Fades', exact: true });
	const length = dialog.getByRole('textbox', { name: 'Fade-in length', exact: true });
	await length.clear();
	await length.pressSequentially('0,1');
	const apply = dialog.getByRole('button', { name: 'Apply', exact: true });
	await expect(apply).toBeEnabled();
	await expect(clip.locator('[data-clip-fade-handle="in"]')).toHaveAttribute('aria-valuenow', '0.1');
	await length.locator('..').getByRole('button', { name: 'Increase value', exact: true }).click();
	await expect(apply).toBeEnabled();
	expect(Number((await length.inputValue()).replace(',', '.'))).toBe(.2);
	await apply.click();
	await expect(clip.locator('[data-clip-fade-handle="in"]')).toHaveAttribute('aria-valuenow', '0.2');
});
