/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { aacLcAdtsPceFixture } from '../helpers/os-audio-codec-fixtures.ts';

for (const pce of [false, true]) for (const generic of [false, true]) test(`AAC programme configuration preserves native import PCM (PCE=${pce}, generic=${generic})`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = aacLcAdtsPceFixture(pce);
	const expected = await page.evaluate(async bytes => {
		const context = new AudioContext();
		try {
			const decoded = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
			return { supported: true, sampleRate: decoded.sampleRate, frames: decoded.length,
				channels: Array.from({ length: decoded.numberOfChannels }, (_, channel) => [...decoded.getChannelData(channel)]) };
		} catch (error) { return { supported: false, error: `${error.name}: ${error.message}` };
		} finally { await context.close(); }
	}, [...file]);
	if (expected.supported) { expect(expected.channels).toHaveLength(2); expect(Math.max(...expected.channels[0])).toBeGreaterThan(.2); }
	await editor.locator('[data-import-input]').setInputFiles({ name: generic ? 'Recording.bin' : 'Recording.aac',
		mimeType: generic ? 'application/octet-stream' : 'audio/aac', buffer: Buffer.from(file) });
	if (!expected.supported) {
		// This platform cannot decode the profile natively; admission adds no decoder.
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toContainText('0 file(s) imported, 1 failed', { timeout: 15_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await editor.locator('[data-import-input]').setInputFiles({ name: 'Supported.aac', mimeType: 'audio/aac', buffer: Buffer.from(aacLcAdtsPceFixture(false)) });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
		return;
	}
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading)); const document = JSON.parse(strFromU8(entries['project.json']));
	const source = document.sources[0]; expect(source.channelCount).toBe(2);
	if (pce || generic) {
		expect(source).toMatchObject({ sampleRate: expected.sampleRate, frameCount: expected.frames });
		const [, payload] = Object.entries(entries).find(([name]) => name.endsWith('.f32c')); const bytes = Buffer.from(payload);
		expect(bytes.readUInt32LE(0)).toBe(expected.frames);
		for (let channel = 0; channel < 2; channel++) expect(Array.from({ length: expected.frames }, (_, frame) =>
			bytes.readFloatLE(4 + (channel * expected.frames + frame) * 4))).toEqual(expected.channels[channel]);
	} else {
		// The healthy incremental route keeps its authored source clock independently of hardware.
		expect(source).toMatchObject({ sampleRate: 48_000, frameCount: 6144 });
	}
});
