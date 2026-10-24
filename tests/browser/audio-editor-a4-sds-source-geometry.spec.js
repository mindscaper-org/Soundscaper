/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { nativeSdsFixture } from '../helpers/native-sds-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes,
	openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

async function exportFloatWave(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await dialog.locator('[data-export-field="sampleRate"] input').fill('32000');
	await dialog.locator('[data-export-field="sampleRate"] input').press('Tab');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	return readDownloadBytes(page, link);
}

for (const format of ['sds', 'sds-open', 'opaque', 'wav']) test(`native SDS ${format} retains authored32k PCM and extent through File Import, Save and WAV export`, async ({ page, browser }) => {
	test.setTimeout(60_000);
	await page.addInitScript(() => {
		const Native = globalThis.AudioContext;
		globalThis.AudioContext = class extends Native { constructor(options) { super({ ...options, sampleRate: options?.sampleRate ?? 44_100 }); } };
		const property = Object.getOwnPropertyDescriptor(AudioBufferSourceNode.prototype, 'buffer');
		globalThis.__sdsNativeBuffers = [];
		Object.defineProperty(AudioBufferSourceNode.prototype, 'buffer', { ...property, set(buffer) {
			property.set.call(this, buffer);
			if (buffer) globalThis.__sdsNativeBuffers.push({ native: buffer instanceof AudioBuffer, frames: buffer.length, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
		} });
	});
	const { file: original, channels } = nativeSdsFixture();
	const file = format === 'opaque' ? new File([original], 'Reference.bin', { type: 'application/octet-stream' }) : format !== 'wav' ? original : new File([Uint8Array.from(encodeWav(channels, { sampleRate: 32_000, bitDepth: 32, float: true }))], 'Control.wav', { type: 'audio/wav' });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const native = await page.evaluate(async bytes => {
		try { const buffer = await new OfflineAudioContext(1, 1, 32_000).decodeAudioData(Uint8Array.from(bytes).buffer);
			return [0].map(channel => [...buffer.getChannelData(channel)]); } catch { return null; }
	}, [...new Uint8Array(await file.arrayBuffer())]);
	if (format === 'wav') expect(native).not.toBeNull();
	if (native === null) {
		await editor.locator(format === 'sds-open' ? '[data-aup4-input]' : '[data-import-input]').setInputFiles({ name: file.name, mimeType: format === 'sds-open' ? 'application/octet-stream' : file.type, buffer: Buffer.from(await file.arrayBuffer()) });
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toContainText('0 file(s) imported, 1 failed', { timeout: 20_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		const fresh = encodeWav(channels, { sampleRate: 32_000, bitDepth: 32, float: true });
		await editor.locator('[data-import-input]').setInputFiles({ name: 'Fresh.wav', mimeType: 'audio/wav', buffer: Buffer.from(fresh) });
		await expect(editor).toHaveAttribute('data-clip-count', '1'); return;
	}
	expect(native).toHaveLength(1); expect(native[0]).toHaveLength(format === 'wav' ? 4800 : 5120);
	let error = 0;
	for (let channel = 0; channel < 1; channel++) {
		for (let frame = 0; frame < 4800; frame++) error = Math.max(error, Math.abs(native[channel][frame] - channels[channel][frame]));
		expect(native[channel].slice(4800).every(value => value === 0)).toBe(true);
	}
	expect(error).toBeLessThan(1e-7);
	await editor.locator(format === 'sds-open' ? '[data-aup4-input]' : '[data-import-input]').setInputFiles({ name: file.name, mimeType: format === 'sds-open' ? 'application/octet-stream' : file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate: 32_000, frameCount: 4800, channelCount: 1 });
	const pcm = Buffer.from(entries[`audio/${project.sources[0].id}.f32c`]); error = 0;
	for (let channel = 0; channel < 1; channel++) for (let frame = 0; frame < 4800; frame++) {
		error = Math.max(error, Math.abs(pcm.readFloatLE(4 + (channel * 4800 + frame) * 4) - native[channel][frame]));
	}
	expect(error).toBeLessThan(1e-7);
	await page.evaluate(() => { globalThis.__sdsNativeBuffers = []; });
	const wave = await exportFloatWave(page, editor);
	expect(await inspectWavBlobPcm(new Blob([wave]))).toMatchObject({ sampleRate: 32_000, frameCount: 4800, channelCount: 2 });
	const playedBuffers = await page.evaluate(() => globalThis.__sdsNativeBuffers);
	expect(playedBuffers.length).toBeGreaterThan(0); expect(playedBuffers.every(buffer => buffer.native)).toBe(true);
	// A separate floatWAV import of identical native PCM is the delivery control,
	// including the existing32k->48k project->32k export resampling.
	const referencePage = await browser.newPage();
	try {
		await disableNativeSavePicker(referencePage);
		const referenceEditor = await bootEditor(referencePage, '/embed/en/');
		const control = encodeWav(native.map(channel => Float32Array.from(channel.slice(0, 4800))), { sampleRate: 32_000, bitDepth: 32, float: true });
		await referenceEditor.locator('[data-import-input]').setInputFiles({ name: 'Native PCM.wav', mimeType: 'audio/wav', buffer: Buffer.from(control) });
		await expect(referenceEditor).toHaveAttribute('data-clip-count', '1');
		const controlWave = await exportFloatWave(referencePage, referenceEditor);
		const samples = await page.evaluate(async files => Promise.all(files.map(async bytes => {
			const buffer = await new OfflineAudioContext(2, 1, 32_000).decodeAudioData(Uint8Array.from(bytes).buffer);
			return [0, 1].map(channel => [...buffer.getChannelData(channel)]);
		})), [[...wave], [...controlWave]]);
		error = 0;
		for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 4800; frame++) error = Math.max(error, Math.abs(samples[0][channel][frame] - samples[1][channel][frame]));
		expect(error).toBeLessThan(1e-7);
		expect(Math.max(...samples[0][0])).toBeGreaterThan(.1);
	} finally { await referencePage.close(); }
});
