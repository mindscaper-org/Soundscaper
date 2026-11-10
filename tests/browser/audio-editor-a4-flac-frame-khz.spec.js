/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, clipByName, disableNativeSavePicker, downloadBytes, importFiles,
	openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('FLAC rate roundtrips and final constant frames survive native Import and Export', async ({ page }) => {
	const caseTimeout = test.info().timeout;
	test.setTimeout(caseTimeout * 3);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	for (const sampleRate of [64_000, 48_000]) await test.step(`${sampleRate}Hz FLAC roundtrip`, async () => {
		if (sampleRate === 48_000) await freshProject();
		await importFiles(editor, [createWavFixture({ name: 'Programme.wav', duration: .1, frequency: 330, channelAmplitudes: [.3, .1] })]);
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'FLAC');
		await dialog.locator('[data-export-field="sampleRate"] input').fill(String(sampleRate)); await page.keyboard.press('Tab');
		const previousDownload = await dialog.locator('[data-export-download]').count() ? await dialog.locator('[data-export-download]').getAttribute('href') : null;
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
		await expect.poll(() => link.getAttribute('href')).not.toBe(previousDownload);
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
	}, { timeout: caseTimeout });
	await test.step('final704 constant FLAC frames and native24bitWAV output', async () => {
		await freshProject();
		const pcm = new Float32Array(4800).fill(.25);
		const bytes = await encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
			sampleRate: 48_000, channelCount: 1, settings: { compressionLevel: 5 }, maximumOutputBytes: 1024 ** 2 },
		{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
		await importFiles(editor, [{ name: 'Constant.flac', mimeType: 'audio/flac', buffer: Buffer.from(bytes) }]);
		await expect(clipByName(editor, 'Constant.flac')).toBeVisible();
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
		await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '24-bit PCM');
		const previousDownload = await dialog.locator('[data-export-download]').count() ? await dialog.locator('[data-export-download]').getAttribute('href') : null;
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 20_000 });
		await expect.poll(() => link.getAttribute('href')).not.toBe(previousDownload);
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
	}, { timeout: caseTimeout });
	async function freshProject() {
		const previousId = await editor.getAttribute('data-project-id');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', previousId);
		await waitForProjectActivation(editor);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		const projectId = await editor.getAttribute('data-project-id');
		await expect.poll(async () => (await persistedProject(page, projectId))?.sources.length).toBe(0);
	}
});
