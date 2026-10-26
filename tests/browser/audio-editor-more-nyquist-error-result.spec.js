/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('a Nyquist Prompt error cannot publish its earlier successful number', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	const source = dialog.getByRole('textbox', { name: 'Nyquist source', exact: true });
	await source.fill('42 (/ 1 0)');
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(editor.getByRole('alert')).toContainText('division by zero');
	await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toHaveCount(0);
	await source.fill('(print "error: quoted text") 42');
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('42');
});
