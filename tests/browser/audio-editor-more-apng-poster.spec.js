/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { singleFramePosterApng, twoFramePosterApng } from '../helpers/single-frame-poster-apng.ts';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('one-frame APNG retains its encoded animation pixels and half-second clock', async ({ page }, testInfo) => {
	await bootEditor(page, '/framescaper/en/');
	const pixels = await page.evaluate(async bytes => {
		const encoded = new Uint8Array(bytes);
		const draw = image => {
			const canvas = new OffscreenCanvas(1, 1), context = canvas.getContext('2d');
			context.drawImage(image, 0, 0); return [...context.getImageData(0, 0, 1, 1).data];
		};
		const bitmap = await createImageBitmap(new Blob([encoded], { type: 'image/png' }));
		const bitmapPixels = draw(bitmap); bitmap.close();
		if (typeof ImageDecoder !== 'function') return { bitmapPixels, animation: null, duration: null };
		const decoder = new ImageDecoder({ data: encoded, type: 'image/png', preferAnimation: true });
		await decoder.tracks.ready;
		const { image } = await decoder.decode({ frameIndex: 0 });
		const animation = draw(image), duration = image.duration, frameCount = decoder.tracks.selectedTrack.frameCount; image.close(); decoder.close(); return { bitmapPixels, animation, duration, frameCount };
	}, [...singleFramePosterApng()]);
	await testInfo.attach('apng-reference-pixels.json', { body: JSON.stringify(pixels), contentType: 'application/json' });
	expect([[255, 0, 0, 255], [0, 0, 255, 255]]).toContainEqual(pixels.bitmapPixels);
	if (pixels.animation) {
		expect(pixels.animation).toEqual([0, 0, 255, 255]);
		if (pixels.duration !== null) expect(pixels.duration).toBe(500_000);
	}
});

test('static-only image import refuses a one-frame APNG instead of publishing its different poster', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const staticOnly = await page.evaluate(() => typeof globalThis.ImageDecoder !== 'function' && typeof createImageBitmap === 'function');
	test.skip(!staticOnly, 'This workflow exercises the actual browser bitmap fallback.');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: singleFramePosterApng() });
	await expect(page.getByRole('alert').filter({ hasText: 'This animated image requires an available browser animation decoder.' })).toBeVisible();
	await expect(editor.getByRole('group', { name: 'Image clip: poster', exact: true })).toHaveCount(0);
});


for (const frameCount of [1, 2]) test(`native APNG import preserves ${frameCount} authored frames in the saved source`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	test.skip(!await page.evaluate(() => typeof globalThis.ImageDecoder === 'function'), 'This workflow uses the native animation decoder.');
	const id = await editor.getAttribute('data-project-id');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await chooser).setFiles({ name: 'half-second.png', mimeType: 'image/png', buffer: frameCount === 1 ? singleFramePosterApng() : twoFramePosterApng() });
	await expect(editor.getByRole('group', { name: 'Image clip: half-second', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const database = open.result, request = database.transaction('projects').objectStore('projects').get(id);
			request.onerror = () => { database.close(); reject(request.error); };
			request.onsuccess = () => {
				const source = request.result?.sources.find(source => source.kind === 'image');
				database.close(); resolve({ duration: source?.canonical.durationTicks, timing: source?.canonical.timingMode, frames: source?.canonical.frameCount });
			};
		};
	}), { databaseName: FRAMESCAPER_DATABASE_NAME, id })).toEqual({ duration: String(frameCount * 500_000), timing: 'embedded', frames: frameCount });
});
