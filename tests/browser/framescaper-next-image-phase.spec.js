/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import { ordinaryFramescaperImage } from '../helpers/framescaper-ordinary-animation-fixture.ts';

async function centerPixel(page, canvas) {
	const png = await canvas.screenshot();
	return page.evaluate(async bytes => {
		const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
		const scratch = document.createElement('canvas'); scratch.width = image.width; scratch.height = image.height;
		const context = scratch.getContext('2d'); context.drawImage(image, 0, 0);
		const pixel = [...context.getImageData(image.width / 2, image.height / 2, 1, 1).data]; image.close(); return pixel;
	}, [...png]);
}

test('Split preserves an ordinary APNG picture at its later presentation boundary', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const available = await page.evaluate(async () => typeof ImageDecoder === 'function'
		&& await ImageDecoder.isTypeSupported('image/png') && !!document.createElement('canvas').getContext('webgl2'));
	test.skip(!available, 'Animated PNG or WebGL2 preview is unavailable.');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await chooser).setFiles({ name: 'animation.png', mimeType: 'image/png', buffer: ordinaryFramescaperImage('animated.png') });
	const clips = editor.getByRole('group', { name: 'Image clip: animation', exact: true });
	await expect(clips).toHaveCount(1); await clips.press('Enter');
	await expect(clips.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	const preview = editor.locator('[data-video-preview]');
	if (!await preview.count()) await chooseCommandAction(page, editor, 'Window', 'Video preview');
	const canvas = preview.locator('[data-video-preview-canvas]');
	await seekFramescaperTimecode(page, editor, '00:00:01:00');
	await expect.poll(async () => (await centerPixel(page, canvas))[1]).toBeGreaterThan(100);
	await seekFramescaperTimecode(page, editor, '00:00:00:01');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split']);
	await expect(clips).toHaveCount(2);
	await seekFramescaperTimecode(page, editor, '00:00:01:00');
	await expect.poll(async () => (await centerPixel(page, canvas))[1]).toBeGreaterThan(100);
});
