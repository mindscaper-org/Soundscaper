/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioMetadataId3Tag } from '../../src/common/editor/id3-metadata.js';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('MP3 File Open retains the exported recording length after a metadata tag is prepended', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Original.wav', frequency: 440, duration: 1, channelCount: 1 })]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP3');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, download);
	expect(String.fromCharCode(...bytes.slice(0, 3))).toBe('ID3');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	const extra = createAudioMetadataId3Tag({ artist: 'Session artist' });
	const file = Buffer.concat([Buffer.from(extra), Buffer.from(bytes)]);
	await importFiles(editor, [{ name: 'Tagged recording.mp3', mimeType: 'audio/mpeg', buffer: file }]);
	const id = await editor.getAttribute('data-project-id');
	await expect.poll(async () => (await persistedProject(page, id))?.sources.find(source => source.name === 'Tagged recording.mp3')?.frameCount).toBe(48_000);
});
