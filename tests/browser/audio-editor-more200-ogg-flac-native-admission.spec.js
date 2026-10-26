/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { ordinaryOggFlacFixture } from '../helpers/ogg-multiplexed-tail-fixture.ts';

for (const generic of [true, false]) test(`File Import preserves Ogg-FLAC audio with generic name=${generic}`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await ordinaryOggFlacFixture();
	const expected = await page.evaluate(async bytes => {
		const context = new OfflineAudioContext(1, 1, 48_000); const decoded = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
		return [...decoded.getChannelData(0)];
	}, [...new Uint8Array(await file.arrayBuffer())]);
	expect(expected).toHaveLength(1024); expect(Math.max(...expected)).toBeGreaterThan(.29);
	await editor.locator('[data-import-input]').setInputFiles({ name: generic ? 'Recorder.bin' : file.name,
		mimeType: generic ? '' : file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading)); const document = JSON.parse(strFromU8(entries['project.json']));
	expect(document.sources[0]).toMatchObject({ sampleRate: 48_000, channelCount: 1, frameCount: 1024 });
	const [, payload] = Object.entries(entries).find(([name]) => name.endsWith('.f32c')); const bytes = Buffer.from(payload);
	expect(Array.from({ length: 1024 }, (_, frame) => bytes.readFloatLE(4 + frame * 4))).toEqual(expected);
});
