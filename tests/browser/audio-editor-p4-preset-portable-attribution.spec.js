/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, downloadBytes, importFiles, openExportDialog } from './audio-editor-test-helpers.js';

test('P015 ancillary: unchanged Save retains portable licensing and fallback declarations in exported preset files', async ({ page }) => {
	test.setTimeout(60_000); await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	await importFiles(editor, [toneA]); const dialog = await openExportDialog(page, editor);
	const presets = [{ schemaVersion: 1, id: 'flac-delivery', label: 'FLAC delivery', kind: 'audio', format: 'flac', settings: {}, licensingRowId: 'flac-1-5-0-desktop-wasm', fallbackPresetId: 'wav-delivery' },
		{ schemaVersion: 1, id: 'wav-delivery', label: 'WAV delivery', kind: 'audio', format: 'wav', settings: {} }];
	await dialog.getByRole('button', { name: 'More options', exact: true }).click(); const choosing = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Import preset', exact: true }).click();
	await (await choosing).setFiles({ name: 'lossless.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, presets })) });
	await dialog.getByRole('button', { name: 'Preset', exact: true }).click(); await page.getByRole('option', { name: /^FLAC delivery \(custom\)/u }).click();
	for (const save of [false, true]) {
		if (save) { await dialog.getByRole('button', { name: 'Save preset', exact: true }).click(); await page.getByRole('menuitem', { name: 'Save preset', exact: true }).click(); }
		await dialog.getByRole('button', { name: 'More options', exact: true }).click(); const downloading = page.waitForEvent('download');
		await page.getByRole('menuitem', { name: 'Export preset', exact: true }).click(); const download = await downloading;
		let file; try { file = JSON.parse(Buffer.from(await downloadBytes(download)).toString('utf8')); } finally { await download.delete(); }
		expect(file.presets[0].id).toBe('flac-delivery'); expect(file.presets[0].format).toBe('flac');
		expect(file.presets[0].licensingRowId).toBe(presets[0].licensingRowId); expect(file.presets[0].fallbackPresetId).toBe(presets[0].fallbackPresetId);
	}
});
