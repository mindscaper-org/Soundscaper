/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';

test('formatting a folder path in recording notes preserves its trailing backslash', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Recording notes']);
	const panel = editor.locator('[data-workspace-panel="recording-notes"]');
	const notes = panel.getByRole('textbox', { name: 'Recording notes', exact: true });
	const path = 'C:\\Takes\\';
	await notes.fill(path);
	await notes.press('ControlOrMeta+A');
	await panel.getByRole('button', { name: 'Bold', exact: true }).click();
	await panel.getByRole('button', { name: 'Preview', exact: true }).click();
	const preview = panel.getByRole('region', { name: 'Recording notes preview', exact: true });
	await expect(preview.locator('strong')).toHaveText(path);
	await expect(preview).toHaveText(path);
	await panel.getByRole('button', { name: 'Edit', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(notes).toHaveValue(path);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await panel.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect(preview.locator('strong')).toHaveText(path);
	expect(errors).toEqual([]);
});
