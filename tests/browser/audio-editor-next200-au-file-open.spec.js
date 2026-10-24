/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { sunPcmAu48_000Fixture } from '../helpers/os-audio-codec-fixtures.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const [name, mimeType, opening] of [['Recording.au', 'application/octet-stream', true], ['Recording.snd', 'application/octet-stream', true],
	['Control.au', 'audio/basic', false]]) {
	test(`File ${opening ? 'Open' : 'Import'} retains the existing native AU audio for ${name}`, async ({ page }) => {
		const original = sunPcmAu48_000Fixture();
		const buffer = Buffer.from(await original.arrayBuffer());
		await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
		const expected = await page.evaluate(async bytes => {
			try {
				const context = new OfflineAudioContext(1, 1, 48_000);
				const decoded = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
				return [...decoded.getChannelData(0)];
			} catch { return null; }
		}, [...buffer]);
		test.skip(expected === null, 'This platform does not decode the existing native AU profile.');
		expect(expected).toHaveLength(4800);
		await editor.locator(opening ? '[data-aup4-input]' : '[data-import-input]').setInputFiles({ name, mimeType, buffer });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		const pending = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
		const archive = unzipSync(await downloadBytes(await pending));
		const project = JSON.parse(strFromU8(archive['project.json']));
		expect(project.sources[0]).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
		const pcm = Buffer.from(Object.entries(archive).find(([key]) => key.endsWith('.f32c'))[1]);
		let error = 0;
		for (let frame = 0; frame < 4800; frame++) error = Math.max(error, Math.abs(pcm.readFloatLE(4 + frame * 4) - expected[frame]));
		expect(error).toBeLessThan(1e-7);
	});
}
