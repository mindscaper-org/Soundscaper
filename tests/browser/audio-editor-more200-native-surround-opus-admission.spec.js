/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { surroundOggOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

for (const generic of [false, true]) test(`six-channel Opus File Import preserves native PCM (generic filename=${generic})`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = await surroundOggOpusFixture();
	const expected = await page.evaluate(async bytes => {
		const context = new OfflineAudioContext(2, 1, 48_000);
		const decoded = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
		return Array.from({ length: decoded.numberOfChannels }, (_, channel) => [...decoded.getChannelData(channel)]);
	}, [...new Uint8Array(await file.arrayBuffer())]);
	expect(expected).toHaveLength(6);
	await editor.locator('[data-import-input]').setInputFiles({ name: generic ? 'Surround.bin' : file.name,
		mimeType: generic ? '' : file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading));
	const document = JSON.parse(strFromU8(entries['project.json']));
	expect(document.sources[0]).toMatchObject({ channelCount: 6, sampleRate: 48_000, frameCount: 3840 });
	const [, payload] = Object.entries(entries).find(([name]) => name.endsWith('.f32c'));
	const bytes = Buffer.from(payload);
	for (let channel = 0; channel < 6; channel++) {
		let error = 0;
		for (let frame = 0; frame < 3840; frame++) error = Math.max(error,
			Math.abs(bytes.readFloatLE(4 + (channel * 3840 + frame) * 4) - expected[channel][frame]));
		expect(error).toBeLessThan(.00002);
	}
});

test('a failed whole-file surround decode does not publish partial audio', async ({ page, browserName }) => {
	test.skip(browserName !== 'webkit', 'This negative control uses the genuine WebKit incremental Opus refusal.');
	await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		for (const Context of [globalThis.AudioContext, globalThis.OfflineAudioContext]) if (Context) {
			Context.prototype.decodeAudioData = () => Promise.reject(new DOMException('Whole-file decoder unavailable', 'EncodingError'));
		}
	});
	const editor = await bootEditor(page, '/embed/en/');
	const file = await surroundOggOpusFixture();
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toContainText('0 file(s) imported, 1 failed', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading));
	const document = JSON.parse(strFromU8(entries['project.json']));
	expect(document.sources).toHaveLength(0);
	expect(Object.keys(entries).filter(name => name.endsWith('.f32c'))).toHaveLength(0);
});
