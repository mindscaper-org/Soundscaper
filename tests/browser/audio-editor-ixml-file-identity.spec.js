/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

// Native BWF MetaEdit26.08.1 --in-iXML over stereo48kHz16bit recording.
const recording = Buffer.from(readFileSync(new URL('../fixtures/bwfmetaedit-file-uid.wav.base64', import.meta.url), 'utf8').trim(), 'base64');
const uid = 'RECORDER-FILE-UNIQUE-0001';
const warning = 'The source file identifier was omitted from newly rendered audio files.';

test('native Save retains the original recorder file identity as source context', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Recorder.wav', mimeType: 'audio/wav', buffer: recording }]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	const entries = unzipSync(await downloadBytes(download)); await download.delete();
	const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.metadata.ixml.rawXml).toContain(`<FILE_UID>${uid}</FILE_UID>`);
});

test('different rendered BWF ranges retain family context without claiming the source physical identity', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Recorder.wav', mimeType: 'audio/wav', buffer: recording }]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const lengths = [];
	for (const end of ['00:00:00.040', '00:00:00.080']) {
		const endpoint = editor.getByRole('group', { name: 'Selection end', exact: true });
		await endpoint.dblclick();
		const input = endpoint.getByRole('textbox'); await input.fill(end); await input.press('Enter');
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
		await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Current selection');
		await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible();
		const chunks = riffChunks(await readDownloadBytes(page, link));
		const xml = new TextDecoder().decode(chunks.get('iXML'));
		expect(xml).not.toContain('<FILE_UID>');
		expect(xml).toContain('<FAMILY_UID>TAKE-FAMILY-0001</FAMILY_UID>');
		lengths.push(chunks.get('data').length);
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toBeHidden();
	}
	expect(lengths).toEqual([1920 * 4, 3840 * 4]);
	await chooseFileAction(page, editor, 'Delivery Report');
	await expect(page.getByRole('dialog', { name: 'Delivery Report', exact: true })).toContainText(warning);
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
