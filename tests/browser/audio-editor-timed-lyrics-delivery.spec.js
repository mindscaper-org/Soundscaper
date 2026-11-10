/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, closeWorkspacePanel, disableNativeSavePicker,
	importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const selected of [false, true]) test(`timed ID3 lyrics follow the delivered audio origin: selection=${selected}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const samples = new Float32Array(48_000); samples.fill(.5, 36_000, 36_048);
	await importFiles(editor, [{ name: 'Pulse.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([samples], { sampleRate: 48_000, bitDepth: 16, dither: false })) }]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-metadata-editor]');
	await panel.getByRole('tab', { name: 'ID3', exact: true }).click();
	const lyrics = panel.getByRole('textbox', { name: 'Timed lyrics ([mm:ss.xxx] text)', exact: true });
	await lyrics.fill('[00:00.750]Pulse'); await lyrics.press('Tab');
	await closeWorkspacePanel(editor, 'metadata');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	if (selected) {
		const start = editor.getByRole('group', { name: 'Selection start', exact: true }); await start.dblclick();
		const input = start.getByRole('textbox'); await input.fill('00:00:00.500'); await input.press('Enter');
	}
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Current selection');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible();
	const chunks = riffChunks(await readDownloadBytes(page, link));
	const fmt = chunks.get('fmt '), data = chunks.get('data');
	const block = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength).getUint16(12, true);
	const pcm = new DataView(data.buffer, data.byteOffset, data.byteLength); let onset = -1;
	for (let offset = 0; offset < data.length; offset += block) {
		if (Math.abs(pcm.getInt16(offset, true) / 32_768) > .1) { onset = offset / block; break; }
	}
	expect(onset).toBe(selected ? 12_000 : 36_000);
	expect(data.length / block).toBe(selected ? 24_000 : 48_000);
	const tag = chunks.get('id3 '); let timestamp;
	for (let offset = 10; offset + 10 <= tag.length;) {
		const length = tag.subarray(offset + 4, offset + 8).reduce((value, byte) => value * 128 + byte, 0);
		if (new TextDecoder().decode(tag.subarray(offset, offset + 4)) === 'SYLT') {
			timestamp = new DataView(tag.buffer, tag.byteOffset + offset + 10 + length - 4, 4).getUint32(0);
		}
		offset += 10 + length;
	}
	expect(timestamp).toBe(selected ? 250 : 750);
});

function riffChunks(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks = new Map();
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, true);
		chunks.set(new TextDecoder().decode(bytes.subarray(offset, offset + 4)), bytes.subarray(offset + 8, offset + 8 + size));
		offset += 8 + size + (size & 1);
	}
	return chunks;
}
