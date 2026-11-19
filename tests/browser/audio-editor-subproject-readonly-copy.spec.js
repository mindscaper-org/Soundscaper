/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, chooseNestedCommandAction, collectClientErrors,
	disableNativeSavePicker, importFiles, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

async function rename(page, editor, title) {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(title);
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
}

test('a parent made read-only by another tab can export its installed subproject audio', async ({ page, context }) => {
	test.setTimeout(45000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await rename(page, editor, 'Saved child');
	await importFiles(editor, [toneA]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseFileAction(page, editor, 'New'); await waitForProjectActivation(editor);
	await rename(page, editor, 'Read-only parent');
	await chooseFileAction(page, editor, 'Subprojects');
	const dialog = page.getByRole('dialog', { name: 'Subprojects', exact: true });
	await dialog.getByRole('combobox', { name: 'Project to insert or relink', exact: true }).selectOption({ label: 'Saved child' });
	await dialog.getByRole('button', { name: 'Insert subproject', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Saved child — Automatic updates', exact: true })).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const id = await editor.getAttribute('data-project-id'), before = await persistedProject(page, id);
	const other = await context.newPage();
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(other); await other.goto(page.url());
	const second = await waitForEditor(other); await waitForProjectActivation(second);
	await expect(second).toHaveAttribute('data-project-id', id);
	await expect(editor.getByRole('button', { name: /Record.*read-only/iu })).toBeDisabled();
	await page.bringToFront();
	const [download] = await Promise.all([
		page.waitForEvent('download', { timeout: 10000 }),
		chooseExportProjectFileAction(page, editor),
	]);
	expect(download.suggestedFilename()).toMatch(/\.sscape$/u);
	expect(await download.failure()).toBeNull();
	expect(await persistedProject(page, id)).toEqual(before);
	expect(errors).toEqual([]);
	await other.close();
});
