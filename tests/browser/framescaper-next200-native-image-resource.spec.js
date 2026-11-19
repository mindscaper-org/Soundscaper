/* SPDX-License-Identifier: AGPL-3.0-only */
import { ordinaryImageResourceFixture } from '../helpers/ordinary-image-resource-fixture.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { strFromU8, unzipSync } from 'fflate';
import { openFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, disableNativeSavePicker, chooseExportProjectFileAction, downloadBytes } from './audio-editor-test-helpers.js';

test('native image admission refuses an oversized PNG before allocating its raster', async ({ page }) => {
	const errors = collectClientErrors(page);
	await observeRasterOpens(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await page.evaluate(() => { globalThis.__nativeRasterOpens = []; });
	const choosing = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await choosing).setFiles({ name: 'ordinary.png', mimeType: 'image/png', buffer: ordinaryImageResourceFixture('png-large') });
	await expect(page.getByRole('alert').filter({ hasText: 'Image sdr pixels exceed the per-frame limit.' })).toBeVisible();
	await expect(editor.getByRole('group', { name: 'Image clip: ordinary', exact: true })).toHaveCount(0);
	expect(await page.evaluate(() => globalThis.__nativeRasterOpens)).toEqual([]);
	expect(errors).toEqual([]);
});

// Node authenticates per-file custody and history. Keep every actual native decoder and pixel witness.
test('native raster formats retain original bytes and RGBA through one image batch, Save and reload', async ({ page }) => {
	test.setTimeout(60_000);
	const errors = collectClientErrors(page);
	await observeRasterOpens(page); await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await page.evaluate(() => { globalThis.__nativeRasterOpens = []; });
	const files = ['png', 'jpeg', 'gif', 'webp', 'bmp'].map(format => ({ name: `ordinary-${format}.${format}`,
		mimeType: `image/${format}`, buffer: ordinaryImageResourceFixture(`${format}-small`), pixel: [33, 99, 181, 255] }));
	// Retain the original precision-control fixture as well as the opaque RGB PNG.
	files.push({ name: 'ordinary-rgba.png', mimeType: 'image/png', buffer: createPngFixture(16), pixel: [0, 0, 0, 0] });
	const choosing = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await choosing).setFiles(files);
	await expect(editor).toHaveAttribute('data-clip-count', String(files.length), { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	expect(await page.evaluate(() => globalThis.__nativeRasterOpens)).toEqual(files.map(() => ({ width: 16, height: 16 })));
	await assertSavedImages();
	await page.reload();
	await expect(editor).toHaveAttribute('data-clip-count', String(files.length));
	await assertSavedImages(); expect(errors).toEqual([]);

	async function assertSavedImages() {
		const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
		const download = await saving; let entries;
		try { entries = unzipSync(await downloadBytes(download)); } finally { await download.delete(); }
		const project = JSON.parse(strFromU8(entries['project.json'])), manifest = JSON.parse(strFromU8(entries['manifest.json']));
		const images = project.sources.filter(source => source.kind === 'image'); expect(images).toHaveLength(files.length);
		for (const file of files) {
			const image = images.find(image => image.original.fileName === file.name); expect(image).toBeDefined();
			expect(image.canonical).toMatchObject({ width: 16, height: 16, frameCount: 1 });
			const body = entries[manifest.assets.find(asset => asset.sourceId === `framescaper:image:${image.id}`).entry];
			const reader = await openFramescaperImageFramePackV1({ source: image, read: (offset, length) => body.slice(offset, offset + length) });
			expect(Buffer.from(await reader.readOriginal())).toEqual(file.buffer);
			const rgba = await reader.readFrame(0);
			for (let offset = 0; offset < rgba.length; offset += 4) {
				for (let channel = 0; channel < 3; channel++) expect(Math.abs(rgba[offset + channel] - file.pixel[channel])).toBeLessThanOrEqual(file.pixel[3] ? 3 : 0);
				expect(rgba[offset + 3]).toBe(file.pixel[3]);
			}
		}
	}
});

async function observeRasterOpens(page) {
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
}
