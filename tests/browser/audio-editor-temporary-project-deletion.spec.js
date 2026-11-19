/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, collectClientErrors, getMenuItem, openNestedCommandMenu,
	waitForProjectActivation } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

async function rename(page, editor, title) {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(title);
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
}

test('the temporary-project preference removes an older closed library copy', async ({ page }) => {
	const errors = collectClientErrors(page), editor = await bootEditor(page, '/embed/en/');
	await rename(page, editor, 'Old working copy');
	const oldId = await editor.getAttribute('data-project-id');
	await chooseFileAction(page, editor, 'New'); await waitForProjectActivation(editor);
	await rename(page, editor, 'Recent working copy');
	const recentId = await editor.getAttribute('data-project-id');
	await chooseFileAction(page, editor, 'New'); await waitForProjectActivation(editor);
	await rename(page, editor, 'Current working copy');
	const currentId = await editor.getAttribute('data-project-id');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Advanced$/u }).click();
	const limit = preferences.getByRole('spinbutton', { name: 'Temporary project limit', exact: true });
	await limit.fill('2'); await limit.press('Enter');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('button', { name: 'Close project: Old working copy', exact: true }).click();
	await expect(editor.getByRole('tab', { name: 'Old working copy', exact: true })).toHaveCount(0);
	await expect.poll(() => persistedProject(page, oldId)).toBeNull();
	expect((await persistedProject(page, recentId)).id).toBe(recentId);
	expect((await persistedProject(page, currentId)).id).toBe(currentId);
	const recent = await openNestedCommandMenu(page, editor, 'File', ['Open recent']);
	await expect(getMenuItem(recent, 'Old working copy')).toHaveCount(0);
	await expect(getMenuItem(recent, 'Current working copy')).toBeVisible();
	expect(errors).toEqual([]);
});
