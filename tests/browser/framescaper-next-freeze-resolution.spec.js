/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, chooseNestedCommandAction, chooseCommandAction } from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';
import { FRAMESCAPER_DATABASE_NAME, FRAMESCAPER_OPFS_DIRECTORY_NAME } from './helpers/editor-databases.js';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

test('permanent programme freeze dimensions do not depend on preview quality', async ({ page }) => {
	// Two complete capture/save flows plus Undo exceeded the default 30s in CI.
	// Keep the same-project comparison and each assertion's existing deadline.
	test.setTimeout(60_000);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const exactPreviewAvailable = await page.evaluate(hasWebGl2Capability);
	test.skip(!await page.evaluate(hasDurableMediaStorageCapability, 'indexeddb-only'), 'PNG freeze storage requires durable IndexedDB Blob support.');
	await editor.locator('[data-project-bin-input]').setInputFiles(videoPreviewBenchmarkMedia.file);
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	const projectId = await editor.getAttribute('data-project-id');
	const preview = editor.locator('[data-video-preview]'), canvas = preview.locator('[data-video-preview-canvas]');
	const dimensions = () => canvas.evaluate(element => ({ width: element.width, height: element.height }));
	let full, bounds;
	if (exactPreviewAvailable) {
		await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready');
		full = await canvas.evaluate(element => ({
			width: Math.round(element.getBoundingClientRect().width * devicePixelRatio),
			height: Math.round(element.getBoundingClientRect().height * devicePixelRatio),
		}));
		await expect.poll(dimensions).toEqual(full);
		bounds = await canvas.boundingBox();
	}
	const outputs = [];
	for (const quality of ['Full resolution', 'Quarter resolution']) {
		if (quality === 'Quarter resolution') {
			await chooseNestedCommandAction(page, editor, 'View', ['Video preview resolution', quality]);
			if (exactPreviewAvailable) {
				await expect.poll(dimensions).toEqual({ width: Math.round(full.width / 4), height: Math.round(full.height / 4) });
				expect(await canvas.boundingBox()).toEqual(bounds);
			}
		}
		const clip = editor.getByRole('group', { name: /^Video clip:/u }).first(); await clip.press('Enter');
		await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
		if (exactPreviewAvailable) await expect(preview).toHaveAttribute('data-video-preview-evaluated-timeline-sample', '0');
		else {
			await expect(preview).toHaveAttribute('data-video-preview-renderer', 'fallback');
			await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false');
			await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
		}
		await chooseNestedCommandAction(page, editor, 'Effect', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.freezeVideo']]);
		const dialog = page.getByRole('dialog', { name: 'Freeze Selected Video', exact: true });
		await dialog.locator('[data-framescaper-authoring-freeze]').click();
		if (exactPreviewAvailable) await expect(dialog.getByRole('status')).toHaveText('Exact playhead freeze created.');
		else await expect(dialog.getByRole('status')).toHaveText('The selected visual operation failed. Reopen the dialog and check its settings and selection.');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await chooseCommandAction(page, editor, 'File', 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const output = await persistedFreezePixels(page, projectId);
		outputs.push(output);
		if (!exactPreviewAvailable) expect(output).toEqual([]);
		if (quality === 'Full resolution' && exactPreviewAvailable) {
			await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
			await expect(editor).toHaveAttribute('data-clip-count', '1');
		}
	}
	await test.info().attach('freeze-output-dimensions', { body: JSON.stringify(outputs), contentType: 'application/json' });
	expect(outputs[1]).toEqual(outputs[0]);
	if (exactPreviewAvailable) expect(outputs[0][0]).toMatchObject({ width: 1280, height: 720 });
	expect(errors).toEqual([]);
});

async function persistedFreezePixels(page, projectId) {
	return page.evaluate(async ({ name, id, directoryName }) => {
		const request = input => new Promise((resolve, reject) => { input.onsuccess = () => resolve(input.result); input.onerror = () => reject(input.error); });
		const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
		const db = await request(indexedDB.open(name));
		try {
			const transaction = db.transaction(['projects', 'mediaAssets', 'mediaAssetChunks'], 'readonly');
			const [project, assets, chunks] = await Promise.all([
				request(transaction.objectStore('projects').get(id)),
				request(transaction.objectStore('mediaAssets').getAll()),
				request(transaction.objectStore('mediaAssetChunks').getAll()),
			]);
			const pictures = [];
			for (const source of project.sources.filter(source => source.kind === 'still')) {
				const record = assets.find(asset => asset.sourceId === source.storageKey);
				let blob;
				if (record.storage === 'opfs') {
					const root = await navigator.storage.getDirectory();
					const directory = await root.getDirectoryHandle(directoryName);
					blob = await (await directory.getFileHandle(record.path)).getFile();
				} else if (record.storage === 'indexeddb-video-preview-bytes-v1') {
					blob = new Blob([record.encodedBytes], { type: record.mimeType });
				} else {
					blob = record.blob ?? new Blob(chunks
						.filter(chunk => chunk.mediaChunkToken === record.mediaChunkToken)
						.sort((left, right) => left.index - right.index).map(chunk => chunk.payload));
				}
				if (await digest(await blob.arrayBuffer()) !== source.contentSha256) throw new Error('Persisted freeze content digest does not match its source.');
				const image = await createImageBitmap(blob);
				try {
					if (image.width !== source.width || image.height !== source.height) throw new Error('Persisted freeze dimensions do not match its source.');
					const canvas = document.createElement('canvas');
					canvas.width = image.width; canvas.height = image.height;
					const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
					// Compare every decoded pixel as well as the authenticated PNG body.
					const pixels = context.getImageData(0, 0, image.width, image.height).data;
					pictures.push({ width: image.width, height: image.height, contentSha256: source.contentSha256, pixelSha256: await digest(pixels) });
				} finally { image.close(); }
			}
			return pictures;
		} finally { db.close(); }
	}, { name: FRAMESCAPER_DATABASE_NAME, id: projectId, directoryName: FRAMESCAPER_OPFS_DIRECTORY_NAME });
}
