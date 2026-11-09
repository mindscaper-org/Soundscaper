/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseFileAction, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

// Unmodified BWF MetaEdit --in-iXML over a Python48kHz stereo recording.
const recording = Buffer.from(readFileSync(new URL('../fixtures/bwfmetaedit-mid-side.wav.base64', import.meta.url), 'utf8').trim(), 'base64');
const warning = 'Recorder track names and roles were omitted because the export changes channel routing.';

for (const layout of ['Stereo', 'Mono']) test(`BWF ${layout} export retains truthful recorder channel metadata`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Mid-side.wav', mimeType: 'audio/wav', buffer: recording }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	await dialog.getByRole('radio', { name: layout, exact: true }).check();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const chunks = riffChunks(await readDownloadBytes(page, link));
	const format = chunks.get('fmt ');
	expect(new DataView(format.buffer, format.byteOffset, format.byteLength).getUint16(2, true)).toBe(layout === 'Mono' ? 1 : 2);
	const xml = new TextDecoder().decode(chunks.get('iXML'));
	expect(xml).toContain('<NOTE>Mid-side location take</NOTE>');
	if (layout === 'Stereo') {
		expect(xml).toBe(new TextDecoder().decode(riffChunks(recording).get('iXML')));
		expect(xml).toContain('<CHANNEL_INDEX>4</CHANNEL_INDEX>');
		expect(xml).toContain('<CHANNEL_INDEX>6</CHANNEL_INDEX>');
	} else {
		expect(xml).not.toContain('<TRACK_LIST>');
		expect(xml).not.toContain('M-MID_SIDE');
		expect(xml).not.toContain('S-MID_SIDE');
	}
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseFileAction(page, editor, 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	if (layout === 'Mono') await expect(report).toContainText(warning);
	else await expect(report).not.toContainText(warning);
});

function riffChunks(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunks = new Map();
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, true);
		chunks.set(new TextDecoder().decode(bytes.subarray(offset, offset + 4)), bytes.subarray(offset + 8, offset + 8 + size));
		offset += 8 + size + (size % 2);
	}
	return chunks;
}
