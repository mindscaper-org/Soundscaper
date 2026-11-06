/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { legacyAupFiles } from '../helpers/more200-legacy-aup-file.ts';

for (const key of ['XSourceMedium', 'ALBUM ARTIST', 'SOURCE MEDIUM']) test(`native custom metadata name remains exportable: ${key}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	// Audacity's pinned TagsEditor/Tags::WriteXML contract permits custom ASCII names with spaces.
	const xml = (await projectFile.text()).replace('<wavetrack', `<tags><tag name="${key}" value="Analogue tape"/></tags>\n<wavetrack`);
	await importFiles(editor, [
		{ name: projectFile.name, mimeType: projectFile.type, buffer: Buffer.from(xml) },
		{ name: dataFile.name, mimeType: dataFile.type, buffer: Buffer.from(await dataFile.arrayBuffer()) },
	]);
	await expect(editor.locator('[data-track-row] .track-control-panel__track-name-text').filter({ hasText: /^Voix 日本語 🎙$/u })).toHaveCount(1);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible();
	const bytes = await readDownloadBytes(page, link);
	expect(Buffer.from(bytes).includes(Buffer.from('Analogue tape'))).toBe(true);
	if (key === 'SOURCE MEDIUM') expect(Buffer.from(bytes).includes(Buffer.from('SOURCE MEDIUM'))).toBe(true);
});
