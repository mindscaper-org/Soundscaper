/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('clearing the Nyquist prompt remains an empty saved draft after closing and reopening', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	const source = dialog.getByRole('textbox', { name: 'Nyquist source', exact: true });
	await expect(source).not.toHaveValue('');
	await source.fill('');
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	await expect(source).toHaveValue('');
	await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
});
