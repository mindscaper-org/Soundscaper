/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, downloadBytes, importFiles, openExportDialog, readDownloadBytes, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';

test('an imported delivery preset keeps its exact ID through Apply, Save, file export, reload and Delete', async ({ page }) => {
	test.setTimeout(90_000); await disableNativeSavePicker(page);
	let editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true }); await importFiles(editor, [toneA]);
	let dialog = await openExportDialog(page, editor);
	const preset = (id, label, channelMapping) => ({ schemaVersion: 1, id, label, kind: 'audio', format: 'wav', settings: { channelMapping } });
	await dialog.getByRole('button', { name: 'More options', exact: true }).click(); const choosing = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Import preset', exact: true }).click();
	await (await choosing).setFiles({ name: 'radio.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1,
		presets: [preset('radio', 'Archive stereo', 'stereo'), preset(' radio ', 'Radio mono', 'mono')] })) });
	const choose = async label => {
		await dialog.getByRole('button', { name: 'Preset', exact: true }).click();
		await page.getByRole('option', { name: new RegExp(`^${label} \\(custom\\)`, 'u') }).click();
		await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText(label);
	};
	await choose('Radio mono'); await expect(dialog.locator('[data-export-channel-option="mono"] input')).toBeChecked();
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click(); await page.getByRole('menuitem', { name: 'Save preset', exact: true }).click();
	await dialog.getByRole('button', { name: 'More options', exact: true }).click(); const downloading = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: 'Export preset', exact: true }).click(); const download = await downloading;
	let exported; try { exported = JSON.parse(Buffer.from(await downloadBytes(download)).toString('utf8')); } finally { await download.delete(); }
	expect(exported.presets[0].id).toBe(' radio '); expect(exported.presets[0].label).toBe('Radio mono');
	await page.reload(); editor = await waitForEditor(page); await waitForProjectActivation(editor); dialog = await openExportDialog(page, editor);
	await choose('Radio mono'); await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	const audio = await page.evaluate(async bytes => { const context = new AudioContext({ sampleRate: 48_000 }); try {
		const buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer); return { channels: buffer.numberOfChannels, frames: buffer.length, peak: Math.max(...buffer.getChannelData(0)) };
	} finally { await context.close(); } }, Array.from(await readDownloadBytes(page, link)));
	expect(audio.channels).toBe(1); expect(audio.frames).toBe(38_400); expect(audio.peak).toBeGreaterThan(.05);
	await page.reload(); editor = await waitForEditor(page); await waitForProjectActivation(editor); dialog = await openExportDialog(page, editor);
	await choose('Radio mono'); await dialog.getByRole('button', { name: 'Delete preset', exact: true }).click();
	await choose('Archive stereo'); await expect(dialog.locator('[data-export-channel-option="stereo"] input')).toBeChecked();
});
