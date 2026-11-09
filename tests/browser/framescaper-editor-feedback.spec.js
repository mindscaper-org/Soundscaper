/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, collectClientErrors, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('Framescaper exposes contextual status help and notification history through View', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const hint = 'Drag clips to move them. Drag their edges to trim. Drag in the ruler to create a time selection.';
	await expect(editor.getByText(hint, { exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'View', 'Contextual status help');
	await editor.getByRole('button', { name: 'Undo', exact: true }).hover();
	await expect(editor.getByText('Undo (Ctrl+Z)', { exact: true })).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'View', ['Notifications', 'Notification history…']);
	const history = editor.getByRole('dialog', { name: 'Notifications', exact: true });
	await expect(history).toBeVisible();
	const mute = history.getByRole('checkbox', { name: 'Mute informational notifications', exact: true });
	await mute.click();
	await expect(mute).toHaveAttribute('aria-checked', 'true');
	await history.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(history).toBeHidden();
	await chooseCommandAction(page, editor, 'View', 'Contextual status help');
	await editor.getByRole('button', { name: 'Undo', exact: true }).hover();
	await expect(editor.getByText(hint, { exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});
