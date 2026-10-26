/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { crcOffsetMp3Fixture } from '../helpers/ordinary-cover-mp3-fixture.ts';

test('File Import preserves exactly the same programme in both protected MP3 information-header layouts', async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	for (const [index, layout] of ['unprotected', 'lame-crc', 'crc-offset'].entries()) {
		const file = await crcOffsetMp3Fixture(layout);
		const nativePeak = await page.evaluate(async bytes => {
			const context = new OfflineAudioContext(1, 1, 48_000); const buffer = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
			return Math.max(...buffer.getChannelData(0));
		}, [...new Uint8Array(await file.arrayBuffer())]);
		expect(nativePeak).toBeGreaterThan(.1);
		await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-clip-count', String(index + 1), { timeout: 30_000 });
	}
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading)); const document = JSON.parse(strFromU8(entries['project.json']));
	for (const source of document.sources) expect(source).toMatchObject({ sampleRate: 48_000, channelCount: 1, frameCount: 4800 });
	const pcm = Object.entries(entries).filter(([name]) => name.endsWith('.f32c')).map(([, bytes]) => Buffer.from(bytes));
	expect(pcm).toHaveLength(3); expect(pcm[1]).toEqual(pcm[0]); expect(pcm[2]).toEqual(pcm[0]);
});
