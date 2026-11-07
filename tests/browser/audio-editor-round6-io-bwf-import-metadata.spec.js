/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { readRiffChunks } from '../helpers/read-riff-chunks.ts';
import {
	bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

// The unchanged BWF MetaEdit fixture carries a recorder description and
// half-second iXML slate. Node tests cover each suffix/MIME combination through
// import, archive reopening and the delivery plan; this batch keeps both suffixes.
const recording = Buffer.from(readFileSync(new URL('../fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8').trim(), 'base64');

test('WAV and BWF recorder deliveries import together and retain BEXT and complete iXML', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, ['wav', 'bwf'].map(extension => ({
		name: `production-take.${extension}`, mimeType: 'application/octet-stream', buffer: recording,
	})));
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const delivered = readRiffChunks(await readDownloadBytes(page, link));
	const format = delivered.get('fmt ');
	expect(new DataView(format.buffer, format.byteOffset, format.byteLength).getUint32(4, true)).toBe(48_000);
	expect(delivered.has('iXML')).toBe(true);
	expect(new TextDecoder().decode(delivered.get('iXML'))).toBe(new TextDecoder().decode(readRiffChunks(recording).get('iXML')));
	expect(new TextDecoder().decode(delivered.get('bext').subarray(0, 256))).toContain('Production boom take');
});
