/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../../src/common/editor/wav-pcm-chunk-reader.ts';

for (const bits of [20, 24]) test(`File Export delivers${bits}bit stereo PCM`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]); await expect(editor).toHaveAttribute('data-clip-count', '1');
	await waitForProjectActivation(editor); const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('radio', { name: 'Stereo', exact: true }).check();
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), `${bits}-bit PCM`);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 15_000 });
	const blob = new Blob([new Uint8Array(await readDownloadBytes(page, link))]);
	const descriptor = await inspectWavBlobPcm(blob);
	expect(descriptor.validBitsPerSample).toBe(bits); expect(descriptor.channelCount).toBe(2);
	const { channels } = await createWavBlobPcmChunkReader(blob, { descriptor }).readChunk(0);
	for (const channel of channels) {
		expect(channel.every(Number.isFinite)).toBe(true);
		expect(Math.max(...channel.map(Math.abs))).toBeGreaterThan(.2);
	}
});
