/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, getMenuItem, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';
import { pausedIntraVideoFile } from './fixtures/video-paused-preview-media.js';
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

async function placedVideoPreview(page, file) {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await expect(editor.getByRole('button', { name: 'Add media', exact: true }).first()).toBeEnabled();
	await editor.locator('[data-project-bin-input]').setInputFiles(file);
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor.getByRole('group', { name: /^Video clip:/u })).toHaveCount(1);
	const preview = editor.locator('[data-video-preview]');
	if (!await preview.count()) await chooseCommandAction(page, editor, 'Window', 'Video preview');
	const video = preview.locator('video'); await expect(video).toHaveCount(1);
	await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThan(1);
	return { editor, canvas: preview.locator('[data-video-preview-canvas]') };
}

test('ordinary paused video presents the correct picture on small forward and backward seeks', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The four-frame H264 fixture follows its existing focused Chromium decoder qualification.');
	const { editor, canvas } = await placedVideoPreview(page, videoRetimePreviewMedia.file);
	await expect.poll(async () => (await centerPixel(page, canvas))[0]).toBeGreaterThan(200);
	await seekFramescaperTimecode(page, editor, '00:00:00:02');
	await expect.poll(async () => (await centerPixel(page, canvas))[1]).toBeGreaterThan(200);
	await seekFramescaperTimecode(page, editor, '00:00:00:01');
	await expect.poll(async () => (await centerPixel(page, canvas))[0]).toBeGreaterThan(200);
	await expect.poll(async () => (await centerPixel(page, canvas))[1]).toBeLessThan(50);
});

for (const retimed of [false, true]) test(`paused ${retimed ? 'retimed' : 'ordinary'} preview keeps the indexed picture near the next PTS`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'This H.264 regression targets Chromium picture selection.');
	const { editor, canvas } = await placedVideoPreview(page, pausedIntraVideoFile);
	if (retimed) await authorExactRetime(page, editor);
	for (const [cell, expected] of [[2, [0, 1, 0]], [3, [0, 0, 1]], [4, [1, 1, 0]], [1, [1, 0, 0]]]) {
		await seekFramescaperTimecode(page, editor, `00:00:00:0${cell}`);
		await expect.poll(async () => (await centerPixel(page, canvas)).slice(0, 3).map(channel => Number(channel > 128)))
			.toEqual(expected);
	}
});

async function authorExactRetime(page, editor) {
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await clip.focus();
	await clip.press('Enter');
	const menu = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
	const item = getMenuItem(menu, 'Video retime');
	await item.focus();
	await item.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Video retime', exact: true });
	const map = dialog.locator('[data-video-retime-exact-map="true"]');
	const initial = JSON.parse(await map.inputValue());
	const retime = {
		...initial, points: [initial.points[0], { outerFrame: 4, sourceFrame: { num: 3, den: 1 } }, initial.points.at(-1)],
		segments: [{ mode: 'constant-forward' }, { mode: 'constant-forward' }],
	};
	await map.fill(JSON.stringify(retime));
	await dialog.locator('[data-video-retime-set="true"]').click();
	await expect(dialog.getByRole('status')).toContainText('Video retime updated.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}
