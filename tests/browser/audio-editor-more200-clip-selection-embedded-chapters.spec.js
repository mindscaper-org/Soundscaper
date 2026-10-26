/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { deliverySelectionArchive } from '../helpers/more200-delivery-selection-fixture.ts';

test('MP3 selection export embeds an opted-in chapter inside the selected native clip', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Selected take.sscape', mimeType: 'application/zip',
		buffer: Buffer.from(await (await deliverySelectionArchive()).arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'delivery-clip-selection');
	await waitForProjectActivation(editor);
	await importFiles(editor, [{ name: 'Chapter.txt', mimeType: 'text/plain', buffer: Buffer.from('1.1\t1.2\tInside selected take\n') }]);
	const clip = editor.locator('[data-clip-id="selected"]');
	await clip.focus(); await clip.press('Enter');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP3');
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Current selection');
	const chapters = dialog.getByRole('checkbox', { name: 'Embed labels as chapters', exact: true });
	await expect(chapters).toBeEnabled();
	await chapters.check();
	await dialog.getByRole('checkbox', { name: /^Include effect tails/u }).uncheck();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 30_000 });
	const bytes = Buffer.from(await readDownloadBytes(page, download));
	const offset = bytes.indexOf(Buffer.from('CHAP'));
	expect(offset).toBeGreaterThan(0);
	const identifierEnd = bytes.indexOf(0, offset + 10);
	expect(bytes.readUInt32BE(identifierEnd + 1)).toBe(100);
	expect(bytes.readUInt32BE(identifierEnd + 5)).toBe(200);
	expect(bytes.includes(Buffer.from('Inside selected take'))).toBe(true);
});
