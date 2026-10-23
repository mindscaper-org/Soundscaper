/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { alacM4a48_000Fixture, aacLcM4a48_000Fixture } from '../helpers/os-audio-codec-fixtures.ts';

for (const generic of [false, true]) test(`native ALAC preserves decoded PCM through File Import and Save (generic=${generic})`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/'); const bytes = alacM4a48_000Fixture();
	const expected = await page.evaluate(async ({ data, generic }) => {
		const context = generic ? new AudioContext() : new OfflineAudioContext(2, 1, 48_000);
		try {
			const decoded = await context.decodeAudioData(Uint8Array.from(data).buffer);
			return { supported: true, sampleRate: decoded.sampleRate, frames: decoded.length,
				channels: Array.from({ length: decoded.numberOfChannels }, (_, channel) => [...decoded.getChannelData(channel)]) };
		} catch (error) { return { supported: false, error: `${error.name}: ${error.message}` };
		} finally { if (context instanceof AudioContext) await context.close(); }
	}, { data: [...bytes], generic });
	await editor.locator('[data-import-input]').setInputFiles({ name: generic ? 'Lossless.bin' : 'Lossless.m4a',
		mimeType: generic ? 'application/octet-stream' : 'audio/mp4', buffer: Buffer.from(bytes) });
	if (!expected.supported) {
		// Admission reuses the platform decoder and adds no codec to unsupported hosts.
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toContainText('0 file(s) imported, 1 failed', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await editor.locator('[data-import-input]').setInputFiles({ name: 'Supported.m4a', mimeType: 'audio/mp4', buffer: Buffer.from(aacLcM4a48_000Fixture()) });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 }); return;
	}
	if (!generic) expect(expected).toMatchObject({ sampleRate: 48_000, frames: 4800 });
	expect(expected.frames / expected.sampleRate).toBeCloseTo(.1, 8); expect(expected.channels).toHaveLength(2);
	expect(Math.max(...expected.channels[0])).toBeGreaterThan(.19); expect(Math.max(...expected.channels[1])).toBeGreaterThan(.09);
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading)); const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources).toHaveLength(1); expect(project.sources[0]).toMatchObject({ sampleRate: expected.sampleRate, frameCount: expected.frames, channelCount: 2 });
	const [, payload] = Object.entries(entries).find(([name]) => name.endsWith('.f32c')); const pcm = Buffer.from(payload);
	expect(pcm.readUInt32LE(0)).toBe(expected.frames);
	for (let channel = 0; channel < 2; channel++) expect(Array.from({ length: expected.frames }, (_, frame) => pcm.readFloatLE(4 + (channel * expected.frames + frame) * 4))).toEqual(expected.channels[channel]);
});
