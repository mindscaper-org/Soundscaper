/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { apePreviewMp3Fixture, crcOffsetMp3Fixture } from '../helpers/ordinary-cover-mp3-fixture.ts';

test('File Import ignores an APE binary preview and saves only the original MP3 programme', async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const files = [await crcOffsetMp3Fixture('unprotected'), await apePreviewMp3Fixture(), await apePreviewMp3Fixture(false, true)];
	for (const [index, file] of files.entries()) {
		await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-clip-count', String(index + 1), { timeout: 30_000 });
	}
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading)); const document = JSON.parse(strFromU8(entries['project.json']));
	for (const source of document.sources) expect(source).toMatchObject({ sampleRate: 48_000, channelCount: 1, frameCount: 4800 });
	const pcm = Object.entries(entries).filter(([name]) => name.endsWith('.f32c')).map(([, bytes]) => Buffer.from(bytes));
	expect(pcm).toHaveLength(3); expect(pcm[1]).toEqual(pcm[0]); expect(pcm[2]).toEqual(pcm[0]);
	const values = new Float32Array(pcm[0].buffer.slice(pcm[0].byteOffset, pcm[0].byteOffset + pcm[0].byteLength));
	expect(Math.max(...values)).toBeGreaterThan(.1);
});
