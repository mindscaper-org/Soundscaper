/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, clipByName, collectClientErrors, importFiles, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';

async function openSnapshots(page, editor) {
	await chooseFileAction(page, editor, 'Session snapshots');
	const dialog = page.getByRole('dialog', { name: 'Session snapshots', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

test('named snapshots restore deleted audio, support undo and persist across reloads', async ({ page }) => {
	const errors = collectClientErrors(page);
	let editor = await bootEditor(page, '/embed/en/');
	await expect(page.getByRole('dialog', { name: 'Session snapshots', exact: true })).toHaveCount(0);
	await importFiles(editor, [toneA]);
	let dialog = await openSnapshots(page, editor);
	await expect(dialog.getByText('No snapshots yet.', { exact: true })).toBeVisible();
	await dialog.getByRole('textbox', { name: 'Snapshot name', exact: true }).fill('Before deletion');
	await dialog.getByRole('button', { name: 'Create snapshot', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Before deletion', exact: true })).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	await clipByName(editor, toneA.name).click();
	await page.keyboard.press('Delete');
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
	dialog = await openSnapshots(page, editor);
	await dialog.getByRole('listbox', { name: 'Saved snapshots', exact: true }).selectOption({ label: 'Before deletion' });
	await dialog.getByRole('button', { name: 'Restore snapshot', exact: true }).click();
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	await page.keyboard.press('ControlOrMeta+z');
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	dialog = await openSnapshots(page, editor);
	await dialog.getByRole('listbox', { name: 'Saved snapshots', exact: true }).selectOption({ label: 'Before deletion' });
	await dialog.getByRole('textbox', { name: 'Snapshot name', exact: true }).fill('Original arrangement');
	await dialog.getByRole('button', { name: 'Rename snapshot', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Original arrangement', exact: true })).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	editor = await waitForEditor(page);
	await waitForProjectActivation(editor);
	dialog = await openSnapshots(page, editor);
	await dialog.getByRole('listbox', { name: 'Saved snapshots', exact: true }).selectOption({ label: 'Original arrangement' });
	await dialog.getByRole('button', { name: 'Delete snapshot', exact: true }).click();
	await expect(dialog.getByText('No snapshots yet.', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	expect(errors).toEqual([]);
});
