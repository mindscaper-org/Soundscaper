/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

// ImageMagick -size 2x2 -delay 50 xc:blue, with a loop extension written by gifsicle.
const loopingGif = Buffer.from('R0lGODlhAgACAPAAAAAA/wAAACH/C05FVFNDQVBFMi4wAwEAAAAh/wtJbWFnZU1hZ2ljaw5nYW1tYT0wLjQ1NDU0NQAh+QQAMgD/ACwAAAAAAgACAAACAoRRADs=', 'base64');

for (const bitmapOnly of [false, true]) {
	test(`a one-frame looping GIF keeps its authored half-second duration ${bitmapOnly ? 'with a bitmap decoder' : 'with an animation decoder'}`, async ({ page }) => {
		if (bitmapOnly) await page.addInitScript(() => { Object.defineProperty(globalThis, 'ImageDecoder', { value: undefined }); });
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		if (!bitmapOnly) test.skip(!await page.evaluate(() => typeof ImageDecoder === 'function'), 'This case exercises the native animation decoder.');
		const chooser = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
		await (await chooser).setFiles({ name: 'hold.gif', mimeType: 'image/gif', buffer: loopingGif });
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const saving = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const download = await saving;
		let entries;
		try { entries = unzipSync(await downloadBytes(download)); } finally { await download.delete(); }
		const project = JSON.parse(strFromU8(entries['project.json']));
		expect(project.sources[0].canonical).toMatchObject({ frameCount: 1, durationTicks: '500000', timingMode: 'embedded' });
	});
}
