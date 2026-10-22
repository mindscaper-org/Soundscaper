/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

async function centerPixel(page, canvas) {
	const png = await canvas.screenshot();
	return page.evaluate(async bytes => {
		const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
		const scratch = document.createElement('canvas'); scratch.width = image.width; scratch.height = image.height;
		const context = scratch.getContext('2d'); context.drawImage(image, 0, 0);
		const pixel = [...context.getImageData(image.width / 2, image.height / 2, 1, 1).data]; image.close(); return pixel;
	}, [...png]);
}

test('ordinary paused video presents the correct picture on small forward and backward seeks', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(videoRetimePreviewMedia.file);
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor.getByRole('group', { name: /^Video clip:/u })).toHaveCount(1);
	const preview = editor.locator('[data-video-preview]');
	if (!await preview.count()) await chooseCommandAction(page, editor, 'Window', 'Video preview');
	const video = preview.locator('video'); await expect(video).toHaveCount(1);
	await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThan(1);
	const canvas = preview.locator('[data-video-preview-canvas]');
	await expect.poll(async () => (await centerPixel(page, canvas))[0]).toBeGreaterThan(200);
	await seekFramescaperTimecode(page, editor, '00:00:00:02');
	await expect.poll(async () => (await centerPixel(page, canvas))[1]).toBeGreaterThan(200);
	await seekFramescaperTimecode(page, editor, '00:00:00:01');
	await expect.poll(async () => (await centerPixel(page, canvas))[0]).toBeGreaterThan(200);
	await expect.poll(async () => (await centerPixel(page, canvas))[1]).toBeLessThan(50);
});
