/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { pcmSourceClockCases } from '../helpers/pcm-source-clock-cases.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker,
	downloadBytes, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

// Node owns exact source/render/archive assertions per profile. This native
// batch retains decoder, File-picker, Save, real AudioBuffer and WAV-output wiring.
test('PCM profiles retain their own clocks through one native File Import, Save and WAV export', async ({ page }) => {
	test.setTimeout(test.info().timeout * 3);
	await page.addInitScript(() => {
		const Native = globalThis.AudioContext;
		globalThis.AudioContext = class extends Native { constructor(options) { super({ ...options, sampleRate: options?.sampleRate ?? 44_100 }); } };
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const fixtures = pcmSourceClockCases();
	const files = [];
	for (const fixture of fixtures) {
		const buffer = Buffer.from(await fixture.file.arrayBuffer());
		const native = await page.evaluate(async ({ bytes, rate }) => {
			const decoded = await new OfflineAudioContext(2, 1, rate).decodeAudioData(Uint8Array.from(bytes).buffer);
			return { sampleRate: decoded.sampleRate, frames: decoded.length, channels: decoded.numberOfChannels };
		}, { bytes: [...buffer], rate: fixture.sampleRate });
		expect(native).toEqual({ sampleRate: fixture.sampleRate, frames: fixture.frameCount, channels: fixture.channelCount });
		files.push({ name: fixture.file.name, mimeType: fixture.file.type, buffer });
	}
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(files);
	await expect(editor).toHaveAttribute('data-clip-count', String(fixtures.length), { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await saving;
	let entries;
	try { entries = unzipSync(await downloadBytes(download)); } finally { await download.delete(); }
	const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources).toHaveLength(fixtures.length);
	for (const fixture of fixtures) {
		const source = project.sources.find(source => source.name === fixture.file.name);
		expect(source).toMatchObject({ sampleRate: fixture.sampleRate, frameCount: fixture.frameCount, channelCount: fixture.channelCount });
		const bytes = Buffer.from(entries[`audio/${source.id}.f32c`]);
		expect(bytes.readUInt32LE(0)).toBe(fixture.frameCount);
		let maximumError = 0;
		for (let channel = 0; channel < fixture.channelCount; channel++) for (let frame = 0; frame < fixture.frameCount; frame++) {
			maximumError = Math.max(maximumError, Math.abs(bytes.readFloatLE(4 + (channel * fixture.frameCount + frame) * 4) - fixture.channels[channel][frame]));
		}
		expect(maximumError).toBe(0);
	}
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	const wave = await readDownloadBytes(page, link);
	const output = await page.evaluate(async bytes => {
		const decoded = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
		return { sampleRate: decoded.sampleRate, frames: decoded.length, channels: decoded.numberOfChannels,
			left: decoded.getChannelData(0)[24_000], right: decoded.getChannelData(1)[24_000] };
	}, [...wave]);
	// Only the 18,816-frame 32 kHz recording remains sounding at this point.
	expect(output).toMatchObject({ sampleRate: 48_000, frames: 28_224, channels: 2 });
	expect(output.left).toBeCloseTo(.125, 6); expect(output.right).toBeCloseTo(-.0625, 6);
});
