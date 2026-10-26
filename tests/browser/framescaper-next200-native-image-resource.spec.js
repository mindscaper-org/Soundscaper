/* SPDX-License-Identifier: AGPL-3.0-only */
import { ordinaryImageResourceFixture } from '../helpers/ordinary-image-resource-fixture.ts';
import { strFromU8, unzipSync } from 'fflate';
import { openFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, disableNativeSavePicker, chooseExportProjectFileAction, downloadBytes } from './audio-editor-test-helpers.js';

for (const format of ['png', 'jpeg', 'gif', 'webp', 'bmp']) for (const size of [format === 'png' ? 'large' : 'wide', 'small']) test(`native ${format} allocation obeys decoded admission: ${size}`, async ({ page }) => {
	const errors = collectClientErrors(page);
	await page.addInitScript(() => {
		globalThis.__nativeRasterOpens = [];
		const record = (width, height) => { if (width === 8192 || width === 8193 || width === 16) globalThis.__nativeRasterOpens.push({ width, height }); };
		if (globalThis.ImageDecoder) {
			const decode = ImageDecoder.prototype.decode;
			ImageDecoder.prototype.decode = async function (...args) {
				const result = await Reflect.apply(decode, this, args);
				record(result.image.displayWidth, result.image.displayHeight); return result;
			};
		}
		if (globalThis.createImageBitmap) {
			const create = globalThis.createImageBitmap;
			globalThis.createImageBitmap = async function (...args) {
				const bitmap = await Reflect.apply(create, this, args); record(bitmap.width, bitmap.height); return bitmap;
			};
		}
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await page.evaluate(() => { globalThis.__nativeRasterOpens = []; });
	const bytes = ordinaryImageResourceFixture(`${format}-${size}`);
	const choosing = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await choosing).setFiles({ name: `ordinary.${format}`, mimeType: `image/${format}`, buffer: bytes });
	if (size !== 'small') {
		await expect(page.getByRole('alert').filter({ hasText: format === 'png' ? 'Image sdr pixels exceed the per-frame limit.' : /Image width.*8192/u })).toBeVisible();
		await expect(editor.getByRole('group', { name: 'Image clip: ordinary', exact: true })).toHaveCount(0);
		expect(await page.evaluate(() => globalThis.__nativeRasterOpens)).toEqual([]);
	} else {
		await expect(editor.getByRole('group', { name: 'Image clip: ordinary', exact: true })).toBeVisible();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
		expect(await page.evaluate(() => globalThis.__nativeRasterOpens)).toEqual([{ width: 16, height: 16 }]);
		const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
		const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
		const images = project.sources.filter(source => source.kind === 'image'); expect(images).toHaveLength(1);
		const image = images[0]; expect(image.canonical).toMatchObject({ width: 16, height: 16, frameCount: 1 });
		const manifest = JSON.parse(strFromU8(entries['manifest.json']));
		const body = entries[manifest.assets.find(asset => asset.sourceId === `framescaper:image:${image.id}`).entry];
		const reader = await openFramescaperImageFramePackV1({ source: image, read: (offset, length) => body.slice(offset, offset + length) });
		expect(Buffer.from(await reader.readOriginal())).toEqual(bytes);
		const rgba = await reader.readFrame(0);
		for (let offset = 0; offset < rgba.length; offset += 4) {
			expect(Math.abs(rgba[offset] - 33)).toBeLessThanOrEqual(3); expect(Math.abs(rgba[offset + 1] - 99)).toBeLessThanOrEqual(3);
			expect(Math.abs(rgba[offset + 2] - 181)).toBeLessThanOrEqual(3); expect(rgba[offset + 3]).toBe(255);
		}
		await page.reload(); await expect(editor.getByRole('group', { name: 'Image clip: ordinary', exact: true })).toBeVisible();
	}
	expect(errors).toEqual([]);
});
