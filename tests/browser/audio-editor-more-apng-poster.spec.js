/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { singleFramePosterApng, twoFramePosterApng } from '../helpers/single-frame-poster-apng.ts';
import { strFromU8, unzipSync } from 'fflate';
import { openFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, chooseExportProjectFileAction, downloadBytes } from './audio-editor-test-helpers.js';

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


test('native APNG import saves authored animation frames and timing rather than the separate poster', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	test.skip(!await page.evaluate(() => typeof globalThis.ImageDecoder === 'function'), 'This workflow uses the native animation decoder.');
	const files = [1, 2].map(count => ({ name: `half-second-${count}.png`, mimeType: 'image/png',
		buffer: count === 1 ? singleFramePosterApng() : twoFramePosterApng() }));
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await chooser).setFiles(files);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await saving; let entries;
	try { entries = unzipSync(await downloadBytes(download)); } finally { await download.delete(); }
	const project = JSON.parse(strFromU8(entries['project.json'])), manifest = JSON.parse(strFromU8(entries['manifest.json']));
	expect(project.sources).toHaveLength(2);
	for (const [index, file] of files.entries()) {
		const source = project.sources.find(source => source.original?.fileName === file.name); expect(source).toBeDefined();
		expect(source.canonical).toMatchObject({ width: 1, height: 1, frameCount: index + 1,
			durationTicks: String((index + 1) * 500_000), timingMode: 'embedded' });
		const body = entries[manifest.assets.find(asset => asset.sourceId === `framescaper:image:${source.id}`).entry];
		const reader = await openFramescaperImageFramePackV1({ source, read: (offset, length) => body.slice(offset, offset + length) });
		expect(Buffer.from(await reader.readOriginal())).toEqual(file.buffer);
		for (let frame = 0; frame <= index; frame++) {
			expect([...await reader.readFrame(frame)]).toEqual(frame ? [0, 255, 0, 255] : [0, 0, 255, 255]);
			expect(reader.timings[frame]).toEqual({ presentationTicks: BigInt(frame) * 500_000n, durationTicks: 500_000n });
		}
	}
});
