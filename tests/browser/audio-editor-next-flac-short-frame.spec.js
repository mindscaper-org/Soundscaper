/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, clipByName, disableNativeSavePicker, downloadBytes, importFiles, openExportDialog } from './audio-editor-test-helpers.js';

test('File Import retains the final constant frame from an exported FLAC recording', async ({ page }) => {
	const pcm = new Float32Array(4800).fill(.25);
	const bytes = await encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		sampleRate: 48_000, channelCount: 1, settings: { compressionLevel: 5 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Constant.flac', mimeType: 'audio/flac', buffer: Buffer.from(bytes) }]);
	await expect(clipByName(editor, 'Constant.flac')).toBeVisible();
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '24-bit PCM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const pendingDownload = page.waitForEvent('download');
	await link.click();
	const wav = await downloadBytes(await pendingDownload);
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
	let blockAlign = 0;
	let frames = 0;
	for (let offset = 12; offset + 8 <= wav.length;) {
		const id = new TextDecoder('ascii').decode(wav.subarray(offset, offset + 4));
		const size = view.getUint32(offset + 4, true);
		if (id === 'fmt ') blockAlign = view.getUint16(offset + 20, true);
		if (id === 'data') frames = size / blockAlign;
		offset += 8 + size + (size & 1);
	}
	expect(frames, 'the final704 frames must survive File Import and Export').toBe(4800);
});
