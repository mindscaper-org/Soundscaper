/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { nativeIrcamFixture } from '../helpers/native-ircam-fixture.ts';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes,
	openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

test('native ircam retains authored48k PCM and extent through File Import, Save and WAV export', async ({ page }) => {
	test.setTimeout(60_000);
	await page.addInitScript(() => {
		const Native = globalThis.AudioContext;
		globalThis.AudioContext = class extends Native { constructor(options) { super({ ...options, sampleRate: options?.sampleRate ?? 44_100 }); } };
		const property = Object.getOwnPropertyDescriptor(AudioBufferSourceNode.prototype, 'buffer');
		globalThis.__ircamNativeBuffers = [];
		Object.defineProperty(AudioBufferSourceNode.prototype, 'buffer', { ...property, set(buffer) {
			property.set.call(this, buffer);
			if (buffer) globalThis.__ircamNativeBuffers.push({ native: buffer instanceof AudioBuffer, frames: buffer.length, channels: buffer.numberOfChannels });
		} });
	});
	const { file, channels } = nativeIrcamFixture();
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const native = await page.evaluate(async bytes => {
		try { const buffer = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
			return [0, 1].map(channel => [...buffer.getChannelData(channel)]); } catch { return null; }
	}, [...new Uint8Array(await file.arrayBuffer())]);
	test.skip(native === null, 'This native platform does not decode IRCAM; no decoder is added.');
	expect(native[0].length).toBeGreaterThanOrEqual(4800); expect(native[0].length).toBeLessThan(5824);
	let error = 0;
	for (let channel = 0; channel < 2; channel++) {
		for (let frame = 0; frame < 4800; frame++) error = Math.max(error, Math.abs(native[channel][frame] - channels[channel][frame]));
		expect(native[channel].slice(4800).every(value => value === 0)).toBe(true);
	}
	expect(error).toBeLessThan(1e-7);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const pcm = Buffer.from(entries[`audio/${project.sources[0].id}.f32c`]); error = 0;
	for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 4800; frame++) {
		error = Math.max(error, Math.abs(pcm.readFloatLE(4 + (channel * 4800 + frame) * 4) - channels[channel][frame]));
	}
	expect(error).toBeLessThan(1e-7);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await page.evaluate(() => { globalThis.__ircamNativeBuffers = []; });
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	const wave = await readDownloadBytes(page, link);
	expect(await inspectWavBlobPcm(new Blob([wave]))).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	expect(await page.evaluate(() => globalThis.__ircamNativeBuffers)).toContainEqual({ native: true, frames: 4800, channels: 2 });
	const rendered = await page.evaluate(async bytes => {
		const buffer = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
		return [0, 1].map(channel => [...buffer.getChannelData(channel)]);
	}, [...wave]);
	error = 0;
	for (let channel = 0; channel < 2; channel++) for (let frame = 1000; frame < 3800; frame++) error = Math.max(error, Math.abs(rendered[channel][frame] - channels[channel][frame]));
	expect(error).toBeLessThan(1e-6);
});
