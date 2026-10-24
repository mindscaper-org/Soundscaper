/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, importFiles,
	openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

for (const sampleRate of [64_000, 48_000]) test(`File Export and Import retain a ${sampleRate}Hz FLAC programme`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Programme.wav', duration: .1, frequency: 330, channelAmplitudes: [.3, .1] })]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'FLAC');
	await dialog.locator('[data-export-field="sampleRate"] input').fill(String(sampleRate)); await page.keyboard.press('Tab');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const expected = await page.evaluate(async ({ bytes, rate }) => {
		const buffer = await new OfflineAudioContext(2, 1, rate).decodeAudioData(Uint8Array.from(bytes).buffer);
		return { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) => [...buffer.getChannelData(channel)]) };
	}, { bytes: [...bytes], rate: sampleRate });
	const frameCount = sampleRate / 10;
	expect(expected.sampleRate).toBe(sampleRate); expect(expected.channels).toHaveLength(2); expect(expected.channels[0]).toHaveLength(frameCount);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(dialog).toBeHidden();
	await importFiles(editor, [{ name: 'Delivered.flac', mimeType: 'audio/flac', buffer: Buffer.from(bytes) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const pending = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await pending)), project = JSON.parse(strFromU8(entries['project.json']));
	const source = project.sources.find(candidate => candidate.name === 'Delivered.flac');
	expect(source).toMatchObject({ sampleRate, frameCount, channelCount: 2 });
	const pcm = Buffer.from(entries[`audio/${source.id}.f32c`]); let maximumError = 0;
	for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < frameCount; frame++) {
		maximumError = Math.max(maximumError, Math.abs(pcm.readFloatLE(4 + (channel * frameCount + frame) * 4) - expected.channels[channel][frame]));
	}
	expect(maximumError).toBeLessThan(1e-7);
});
