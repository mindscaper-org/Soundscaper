/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { nativeDolbyFixture } from '../helpers/dolby-native-audio-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker,
	downloadBytes, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

for (const format of ['ac3', 'eac3', 'wav']) test(`native ${format} retains48k source PCM on a44.1k output device`, async ({ page }) => {
	await page.addInitScript(() => {
		const Native = globalThis.AudioContext;
		globalThis.AudioContext = class extends Native {
			constructor(options) { super({ ...options, sampleRate: options?.sampleRate ?? 44_100 }); }
		};
	});
	const channels = [200, 300].map(frequency => Float32Array.from({ length: 6144 }, (_, frame) => .15 * Math.sin(2 * Math.PI * frequency * frame / 48_000)));
	const file = format === 'wav' ? new File([Uint8Array.from(encodeWav(channels, { sampleRate: 48_000, bitDepth: 32, float: true }))], 'Control.wav', { type: 'audio/wav' })
		: nativeDolbyFixture(format);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const expected = await page.evaluate(async bytes => {
		try {
			const decoded = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
			return Array.from({ length: decoded.numberOfChannels }, (_, channel) => [...decoded.getChannelData(channel)]);
		} catch { return null; }
	}, [...new Uint8Array(await file.arrayBuffer())]);
	test.skip(expected === null, 'This native platform does not decode this audio profile; no decoder is added.');
	expect(expected).toHaveLength(2); expect(expected[0]).toHaveLength(6144);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate: 48_000, frameCount: 6144, channelCount: 2 });
	const pcm = Buffer.from(Object.entries(entries).find(([name]) => name.endsWith('.f32c'))[1]);
	for (let channel = 0; channel < 2; channel++) {
		let error = 0;
		for (let frame = 0; frame < 6144; frame++) error = Math.max(error, Math.abs(pcm.readFloatLE(4 + (channel * 6144 + frame) * 4) - expected[channel][frame]));
		expect(error).toBeLessThan(1e-7);
	}
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	const wave = await readDownloadBytes(page, link), descriptor = await inspectWavBlobPcm(new Blob([wave]));
	expect(descriptor).toMatchObject({ sampleRate: 48_000, frameCount: 6144, channelCount: 2 });
	const rendered = await page.evaluate(async bytes => {
		const decoded = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
		return Array.from({ length: 2 }, (_, channel) => [...decoded.getChannelData(channel)]);
	}, [...wave]);
	for (let channel = 0; channel < 2; channel++) {
		let error = 0;
		for (let frame = 1000; frame < 5000; frame++) error = Math.max(error, Math.abs(rendered[channel][frame] - expected[channel][frame]));
		expect(error).toBeLessThan(1e-6);
	}
});
