/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../../src/common/editor/wav-pcm-chunk-reader.ts';

// Node covers each depth through the controller and the buffered/streamed writers.
test('File Export retains the mono speaker across maintained PCM depths', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]); await expect(editor).toHaveAttribute('data-clip-count', '1');
	await waitForProjectActivation(editor);
	for (const bits of [20, 24]) {
		const dialog = await openExportDialog(page, editor);
		await dialog.getByRole('radio', { name: 'Mono', exact: true }).check();
		await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), `${bits}-bit PCM`);
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 20_000 });
		const bytes = await readDownloadBytes(page, link); const blob = new Blob([new Uint8Array(bytes)]);
		const descriptor = await inspectWavBlobPcm(blob); expect(descriptor.channelCount).toBe(1);
		expect(descriptor.validBitsPerSample ?? descriptor.bitDepth).toBe(bits);
		if (bits === 20) expect(descriptor.channelMask).toBe(4);
		const { channels } = await createWavBlobPcmChunkReader(blob, { descriptor }).readChunk(0);
		expect(channels).toHaveLength(1); expect(channels[0].every(Number.isFinite)).toBe(true);
		expect(Math.max(...channels[0].map(Math.abs))).toBeGreaterThan(.2);
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	}
});
