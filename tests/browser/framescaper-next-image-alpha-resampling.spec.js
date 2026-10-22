/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, openExportDialog,
	chooseDropdown, readDownloadBytes, chooseFileAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';

test('a PNG transparent edge survives resized WebM delivery without a dark fringe', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The maintained encoded image publication qualification uses Chromium (framescaper-images.spec.js).');
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const png = await whiteEdgePng(page);
	const choosing = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await choosing).setFiles({ name: 'White edge.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
	await expect(editor.getByRole('group', { name: 'Image clip: White edge', exact: true })).toBeVisible();
	const dialog = await openExportDialog(page, editor, { label: 'Export video' });
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'WebM video');
	await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('4');
	await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('2');
	await dialog.locator('[data-export-field="canvasFrameRate"] input').fill('1');
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Fit', exact: true }), 'Stretch to fill');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 60_000 });
	const bytes = await readDownloadBytes(page, link);
	const row = await page.evaluate(async data => {
		const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: 'video/webm' }));
		const video = document.createElement('video');
		Object.assign(video, { muted: true, playsInline: true, preload: 'auto' }); document.body.append(video);
		try {
			await new Promise((resolve, reject) => {
				video.onloadeddata = resolve; video.onerror = () => reject(video.error);
				video.src = url; video.load();
			});
			const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 2;
			const context = canvas.getContext('2d'); context.drawImage(video, 0, 0);
			return [...context.getImageData(0, 0, 4, 1).data];
		} finally { video.remove(); URL.revokeObjectURL(url); }
	}, [...bytes]);
	await test.info().attach('decoded-PNG-edge', { body: JSON.stringify(row), contentType: 'application/json' });
	// Correct linear coverage is1,3/4,1/4,0. Allow transfer/codec rounding in the tiny movie;
	// exact premultiplied values and opacity are independently pinned by strict Node regressions.
	for (const [pixel, expected, tolerance] of [[0, 255, 16], [1, 223, 18], [2, 131, 18], [3, 0, 12]]) {
		for (let channel = 0; channel < 3; channel++) expect(Math.abs(row[pixel * 4 + channel] - expected)).toBeLessThanOrEqual(tolerance);
		expect(row[pixel * 4 + 3]).toBe(255);
	}
});

test('an imported frozen PNG retains its transparent edge in exact programme preview', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__edgeRows = [];
		const put = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(put, this, args), frame = args[0];
			if (frame.width === 4 && frame.height === 2) globalThis.__edgeRows.push([...frame.data.slice(0, 16)]);
			return result;
		};
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const png = Buffer.from(await whiteEdgePng(page), 'base64');
	const project = createFramescaperProject(PROFILE, { id: 'frozen-alpha-edge', primarySequenceId: 'main',
		visualModel: { stillSources: [{ schemaVersion: 1, kind: 'still', id: 'png', name: 'Frozen PNG', mimeType: 'image/png',
			storageKey: 'png', contentSha256: bytesToHex(sha256(png)), width: 2, height: 2, hasAlpha: true }] },
		clips: [{ schemaVersion: 1, kind: 'still', id: 'still', sourceId: 'png', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['still'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }],
	});
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	await store.writeMediaAsset('png', new Blob([png], { type: 'image/png' }), { name: 'Frozen PNG', mimeType: 'image/png' });
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Frozen edge.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const dialog = await openExportDialog(page, editor, { label: 'Export video' });
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'WebM video');
	await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('4');
	await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('2');
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Fit', exact: true }), 'Stretch to fill');
	// Letterbox paints a black first column; wait for the new stretched frame rather than its old paint.
	await expect.poll(() => page.evaluate(() => globalThis.__edgeRows.at(-1)?.[0] ?? 0)).toBe(255);
	const row = await page.evaluate(() => globalThis.__edgeRows.at(-1));
	expect(row[0]).toBe(255); expect(row[12]).toBe(0); expect(row[4]).toBeGreaterThanOrEqual(218); expect(row[4]).toBeLessThanOrEqual(226);
});

async function whiteEdgePng(page) {
	return page.evaluate(() => {
		const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
		const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 1, 2);
		return canvas.toDataURL('image/png').split(',')[1];
	});
}
