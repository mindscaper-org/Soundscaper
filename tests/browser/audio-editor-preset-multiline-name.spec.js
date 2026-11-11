/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, downloadBytes, importFiles, openExportDialog } from './audio-editor-test-helpers.js';

test('editing an admitted multiline delivery preset name retains it in the exported preset', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const dialog = await openExportDialog(page, editor);
	const original = 'Opening\nRoom tone';
	await dialog.getByRole('button', { name: 'More options', exact: true }).click();
	const choosing = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Import preset', exact: true }).click();
	await (await choosing).setFiles({ name: 'room.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, presets: [
		{ schemaVersion: 1, id: 'room', label: original, kind: 'audio', format: 'wav', settings: {} },
	] })) });
	await dialog.getByRole('button', { name: /^Preset(?::|$)/u }).click();
	await page.getByRole('option', { name: /^Opening\s+Room tone \(custom\)/u }).click();
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const naming = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	const field = naming.getByRole('textbox', { name: 'Preset name', exact: true });
	await field.focus();
	await field.press('Control+End');
	await field.pressSequentially('!');
	await field.press('Enter');
	await expect(naming).toBeHidden();
	await dialog.getByRole('button', { name: 'More options', exact: true }).click();
	const downloading = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: 'Export preset', exact: true }).click();
	const download = await downloading;
	try {
		const actual = JSON.parse(Buffer.from(await downloadBytes(download)).toString('utf8'));
		expect(actual.presets[0].label).toBe(`${original}!`);
	} finally { await download.delete(); }
});
