/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('tabbing through the Project Bin name preserves the imported title', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const title = '  First take  ';
	await importFiles(editor, [createWavFixture({ name: `${title}.wav`, duration: 1, channelCount: 1 })]);
	await editor.locator('[data-clip-id]').first().locator('.clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const name = editor.locator('[data-project-bin-name]');
	await expect(name).toHaveValue(title);
	await name.focus();
	await name.press('Tab');
	await expect(name).toHaveValue(title);
	await name.fill('Edited take');
	await name.press('Enter');
	await expect(name).toHaveValue('Edited take');
});
