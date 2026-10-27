/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, closeWorkspacePanel, disableNativeSavePicker,
	importFiles, openExportDialog,
} from './audio-editor-test-helpers.js';

test('a menu-entered unsupported DTMF symbol retains its public validation message across the worker', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'DTMF tones');
	const dialog = page.getByRole('dialog', { name: 'DTMF tones', exact: true });
	await dialog.getByRole('textbox', { name: 'DTMF sequence', exact: true }).fill('K');
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(page.getByRole('alert').filter({ hasText: 'Use 0–9, A–D, * or #.' }).first()).toBeVisible();
	await expect(dialog).toBeVisible();
});

test('a rating authored in Metadata receives a public field validation before WAV export', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-metadata-editor]');
	await panel.getByRole('tab', { name: 'ID3', exact: true }).click();
	const rating = panel.getByRole('textbox', { name: 'Rating (0–255)', exact: true });
	await rating.fill('300');
	await rating.press('Tab');
	await closeWorkspacePanel(editor, 'metadata');
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(page.getByRole('alert').filter({ hasText: 'Rating (0–255) must be a whole number from 0 to 255.' }).first()).toBeVisible();
	await expect(dialog.locator('[data-export-download]')).toBeHidden();
});
