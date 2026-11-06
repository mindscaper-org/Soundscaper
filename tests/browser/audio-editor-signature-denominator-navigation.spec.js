/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { strFromU8, unzipSync } from 'fflate';

async function openMusicalEditor(page) {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	return editor;
}

async function savedSignatures(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	const project = JSON.parse(strFromU8(unzipSync(await downloadBytes(download))['project.json']));
	await download.delete();
	return project.signatureMap.events;
}

test('the toolbar navigates valid signature denominators by keyboard and native choice popup', async ({ page }) => {
	const editor = await openMusicalEditor(page);
	const field = editor.getByRole('combobox', { name: 'Time signature: denominator', exact: true });
	await expect(field.getByRole('option')).toHaveCount(53);
	await expect(field.getByRole('option', { name: '5', exact: true })).toHaveCount(0);
	await field.focus();
	await field.press('ArrowDown');
	await field.press('Enter');
	expect((await savedSignatures(page, editor))[0].denominator).toBe(8);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(field).toHaveValue('4');
	// Opening the real native choice popup must offer the same next usable value.
	await field.click();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await field.blur();
	expect((await savedSignatures(page, editor))[0].denominator).toBe(8);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(field).toHaveValue('4');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(field).toHaveValue('8');
	const numerator = editor.getByRole('spinbutton', { name: 'Time signature: numerator', exact: true });
	await numerator.focus(); await numerator.press('ArrowUp'); await numerator.press('Enter');
	expect((await savedSignatures(page, editor))[0].numerator).toBe(5);
});

test('a future signature event uses the same allowed denominator choices and saves its draft', async ({ page }) => {
	const editor = await openMusicalEditor(page);
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	await dialog.getByRole('button', { name: 'Add time signature event', exact: true }).click();
	const form = dialog.getByRole('form', { name: 'Time signature event 2', exact: true });
	const field = form.getByRole('combobox', { name: 'denominator', exact: true });
	await expect(field.getByRole('option')).toHaveCount(53);
	await field.focus(); await field.press('ArrowDown');
	await expect(field).toHaveValue('8');
	const save = form.getByRole('button', { name: 'Save', exact: true });
	await save.click();
	await expect(field).toHaveValue('8');
	await expect(save).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	await expect(field).toHaveValue('4');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	await expect(field).toHaveValue('8');
	const signatures = await savedSignatures(page, editor);
	expect(signatures.map(event => event.denominator)).toEqual([4, 8]);
});
