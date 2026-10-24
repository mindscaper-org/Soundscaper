/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { nativeMsAdpcmFixture } from '../helpers/native-ms-adpcm-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes,
	openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

for (const format of ['adpcm', 'pcm']) test(`${format} File Import and Save retain the authored WAV extent`, async ({ page }) => {
	test.setTimeout(60_000);
	const fixture = nativeMsAdpcmFixture(), channels = fixture.channels.map(channel => channel.subarray(0, 4800));
	const file = format === 'adpcm' ? fixture.file : new File([Uint8Array.from(encodeWav(channels, { sampleRate: 48_000, bitDepth: 32, float: true }))], 'Control.wav', { type: 'audio/wav' });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const native = await page.evaluate(async bytes => {
		try { const audio = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer); return [0, 1].map(channel => [...audio.getChannelData(channel)]); }
		catch { return null; }
	}, [...new Uint8Array(await file.arrayBuffer())]);
	test.skip(format === 'adpcm' && native === null, 'This platform does not natively decode MS ADPCM; no decoder is added.');
	expect(native).not.toBeNull();
	let error = 0;
	for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 4800; frame++) error = Math.max(error, Math.abs(native[channel][frame] - channels[channel][frame]));
	expect(error).toBeLessThan(1e-7);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const pcm = Buffer.from(entries[`audio/${project.sources[0].id}.f32c`]);
	for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 4800; frame++) expect(pcm.readFloatLE(4 + (channel * 4800 + frame) * 4)).toBe(channels[channel][frame]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	const wave = await readDownloadBytes(page, link);
	expect(await inspectWavBlobPcm(new Blob([wave]))).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
});
