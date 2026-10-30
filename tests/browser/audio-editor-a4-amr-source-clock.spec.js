/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { nativeAmrwbFixture } from '../helpers/native-amrwb-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes,
	openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

async function exportFloatWave(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await dialog.locator('[data-export-field="sampleRate"] input').fill('16000');
	await dialog.locator('[data-export-field="sampleRate"] input').press('Tab');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	return readDownloadBytes(page, link);
}

for (const format of ['amrwb', 'wav']) test(`native ${format} retains authored16k PCM and extent through File Import, Save and WAV export`, async ({ page, browser }) => {
	test.setTimeout(60_000);
	await page.addInitScript(() => {
		const Native = globalThis.AudioContext;
		globalThis.AudioContext = class extends Native { constructor(options) { super({ ...options, sampleRate: options?.sampleRate ?? 44_100 }); } };
		const property = Object.getOwnPropertyDescriptor(AudioBufferSourceNode.prototype, 'buffer');
		globalThis.__amrwbNativeBuffers = [];
		Object.defineProperty(AudioBufferSourceNode.prototype, 'buffer', { ...property, set(buffer) {
			property.set.call(this, buffer);
			if (buffer) globalThis.__amrwbNativeBuffers.push({ native: buffer instanceof AudioBuffer, frames: buffer.length, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
		} });
	});
	const { file: original, channels } = nativeAmrwbFixture();
	const file = format === 'amrwb' ? original : new File([Uint8Array.from(encodeWav(channels, { sampleRate: 16_000, bitDepth: 32, float: true }))], 'Control.wav', { type: 'audio/wav' });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const native = await page.evaluate(async bytes => {
		try { const buffer = await new OfflineAudioContext(1, 1, 16_000).decodeAudioData(Uint8Array.from(bytes).buffer);
			return [0].map(channel => [...buffer.getChannelData(channel)]); } catch { return null; }
	}, [...new Uint8Array(await file.arrayBuffer())]);
	if (format === 'wav') expect(native).not.toBeNull();
	test.skip(format === 'amrwb' && native === null, 'This native platform does not decode AMR-WB; no decoder is added.');
	expect(native[0]).toHaveLength(4800);
	let error = 0;
	for (let channel = 0; channel < 1; channel++) {
		for (let frame = 0; frame < 4800; frame++) error = Math.max(error, Math.abs(native[channel][frame] - channels[channel][frame]));
	}
	// Independent lossy decoder implementations differ by less than one PCM16 amplitude quantum.
	expect(error).toBeLessThan(format === 'amrwb' ? 1 / 32768 : 1e-7);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate: 16_000, frameCount: 4800, channelCount: 1 });
	const pcm = Buffer.from(entries[`audio/${project.sources[0].id}.f32c`]); error = 0;
	for (let channel = 0; channel < 1; channel++) for (let frame = 0; frame < 4800; frame++) {
		error = Math.max(error, Math.abs(pcm.readFloatLE(4 + (channel * 4800 + frame) * 4) - native[channel][frame]));
	}
	expect(error).toBeLessThan(1e-7);
	await page.evaluate(() => { globalThis.__amrwbNativeBuffers = []; });
	const wave = await exportFloatWave(page, editor);
	expect(await inspectWavBlobPcm(new Blob([wave]))).toMatchObject({ sampleRate: 16_000, frameCount: 4800, channelCount: 2 });
	expect(await page.evaluate(() => globalThis.__amrwbNativeBuffers)).toContainEqual({ native: true, frames: 14400, channels: 1, sampleRate: 48_000 });
	// A separate floatWAV import of identical native PCM is the delivery control,
	// including the existing16k->48k project->16k export resampling and mono pan law.
	const referencePage = await browser.newPage();
	try {
		await disableNativeSavePicker(referencePage);
		const referenceEditor = await bootEditor(referencePage, '/embed/en/');
		const control = encodeWav([Float32Array.from(native[0])], { sampleRate: 16_000, bitDepth: 32, float: true });
		await referenceEditor.locator('[data-import-input]').setInputFiles({ name: 'Native PCM.wav', mimeType: 'audio/wav', buffer: Buffer.from(control) });
		await expect(referenceEditor).toHaveAttribute('data-clip-count', '1');
		const controlWave = await exportFloatWave(referencePage, referenceEditor);
		const samples = await page.evaluate(async files => Promise.all(files.map(async bytes => {
			const buffer = await new OfflineAudioContext(2, 1, 16_000).decodeAudioData(Uint8Array.from(bytes).buffer);
			return [0, 1].map(channel => [...buffer.getChannelData(channel)]);
		})), [[...wave], [...controlWave]]);
		error = 0;
		for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 4800; frame++) error = Math.max(error, Math.abs(samples[0][channel][frame] - samples[1][channel][frame]));
		expect(error).toBeLessThan(1e-7);
		expect(Math.max(...samples[0][0])).toBeGreaterThan(.1);
	} finally { await referencePage.close(); }
});
