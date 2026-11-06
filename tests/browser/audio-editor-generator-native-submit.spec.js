/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName } from './audio-editor-test-helpers.js';

for (const completion of ['footer', 'message Enter']) test(`Morse generation completes once through ${completion}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Morse code');
	const dialog = page.getByRole('dialog', { name: 'Morse code', exact: true });
	const message = dialog.locator('[data-generator-field="text"] input');
	await message.fill('EE');
	await expect(dialog.locator('.kw-audio-editor-generator__morse-code')).toHaveText('. .');
	const generate = dialog.getByRole('button', { name: 'Generate', exact: true });
	await expect(generate).toBeEnabled();
	if (completion === 'footer') await generate.click();
	else await message.press('Enter');
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(clipByName(editor, 'Morse code')).toBeVisible();
});
