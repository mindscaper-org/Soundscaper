/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { unequalAvPreviewFixture } from '../helpers/unequal-av-preview-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const audioSeconds of [2, 10]) test(`video File Import previews only its 2s picture when programme audio lasts ${audioSeconds}s`, async ({ page }) => {
	test.setTimeout(60_000); await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		globalThis.__pictureSeeks = []; globalThis.__pictureDurations = [];
		document.addEventListener('loadedmetadata', event => {
			if (event.target instanceof HTMLVideoElement) globalThis.__pictureDurations.push(event.target.duration);
		}, true);
		document.addEventListener('seeking', event => {
			if (event.target instanceof HTMLVideoElement) globalThis.__pictureSeeks.push(event.target.currentTime);
		}, true);
	});
	const editor = await bootEditor(page, '/embed/en/'), file = unequalAvPreviewFixture(audioSeconds), original = Buffer.from(await file.arrayBuffer());
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: original });
	// Observe either the incorrect native request or normal completion, without imposing a performance threshold.
	await expect.poll(() => page.evaluate(() => globalThis.__pictureSeeks.some(time => time > 2)
		|| document.querySelector('[data-audio-editor]').dataset.clipCount === '2'), { timeout: 45_000 }).toBe(true);
	expect(await page.evaluate(() => globalThis.__pictureSeeks.filter(time => time > 2))).toEqual([]);
	await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 15_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	expect(await page.evaluate(() => globalThis.__pictureDurations)).toContain(audioSeconds);
	const image = editor.locator('.audio-editor-video-clip__filmstrip img').first();
	await expect.poll(() => image.evaluate(value => value.complete && value.naturalWidth === 64 && value.naturalHeight === 32)).toBe(true);
	const rgba = await image.evaluate(value => {
		const canvas = document.createElement('canvas'); canvas.width = value.naturalWidth; canvas.height = value.naturalHeight;
		const context = canvas.getContext('2d'); context.drawImage(value, 0, 0); return [...context.getImageData(32, 16, 1, 1).data];
	});
	expect(rgba[0]).toBeLessThan(40); expect(rgba[1]).toBeGreaterThan(60); expect(rgba[1]).toBeLessThan(100);
	expect(rgba[2]).toBeGreaterThan(200); expect(rgba[3]).toBe(255);
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	const video = project.sources.find(source => source.kind === 'video');
	expect(video).toMatchObject({ sourceFrameCount: 60, sampleFrameCount: 96000, sampleRate: 48000, frameRate: { num: 30, den: 1 } });
	expect(Buffer.from(entries[`media/${video.id}/original`]).equals(original)).toBe(true);
	await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
});
