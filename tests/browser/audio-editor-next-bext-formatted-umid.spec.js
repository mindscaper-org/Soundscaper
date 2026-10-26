/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, closeWorkspacePanel, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

for (const scope of ['project', 'export']) test(`${scope} BEXT editor preserves a formatted 64-byte UMID in the delivered BWF`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const expected = Array.from({ length: 64 }, (_value, index) => index);
	const formatted = `0x${expected.map(value => value.toString(16).padStart(2, '0')).join(':')}`;
	const canonical = expected.map(value => value.toString(16).padStart(2, '0')).join('');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	if (scope === 'project') {
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'BEXT', exact: true }).click();
		const field = panel.locator('input[name="umid"]');
		await field.fill(formatted);
		await expect(field).toHaveValue(formatted);
		await field.press('Tab');
		await expect(field).toHaveValue(canonical);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(field).toHaveValue('');
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(field).toHaveValue(canonical);
		await closeWorkspacePanel(editor, 'metadata');
	}
	let dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	if (scope === 'export') {
		await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
		const metadata = page.getByRole('dialog', { name: 'Metadata', exact: true });
		await metadata.getByRole('tab', { name: 'BEXT', exact: true }).click();
		const field = metadata.locator('input[name="umid"]');
		await field.fill(formatted);
		await expect(field).toHaveValue(formatted);
		await field.press('Tab');
		await metadata.getByRole('button', { name: /^Done\.?$/u }).click();
		dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
	}
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible();
	const bytes = await readDownloadBytes(page, link);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 12, actual;
	while (offset + 8 <= bytes.length) {
		const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
		const size = view.getUint32(offset + 4, true);
		if (id === 'bext') { actual = [...bytes.subarray(offset + 8 + 348, offset + 8 + 412)]; break; }
		offset += 8 + size + (size & 1);
	}
	expect(actual).toEqual(expected);
});
