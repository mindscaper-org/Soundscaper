/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, chooseNestedCommandAction, chooseCommandAction } from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';

test.describe.serial('permanent programme freeze resolution', () => {
	const outputs = [];
	test.afterAll(() => {
		if (outputs.length === 0) return;
		expect(outputs).toHaveLength(2);
		expect(outputs[1]).toEqual(outputs[0]);
	});

	// Fresh projects keep the programme identical without making this pixel
	// comparison wait for Undo to retire the first freeze's decoder and cache.
	for (const quality of ['Full resolution', 'Quarter resolution']) test(`keeps native dimensions at ${quality}`, async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		const exactPreviewAvailable = await page.evaluate(hasWebGl2Capability);
		test.skip(!await page.evaluate(hasDurableMediaStorageCapability, 'indexeddb-only'), 'PNG freeze storage requires durable IndexedDB Blob support.');
		await editor.locator('[data-project-bin-input]').setInputFiles(videoPreviewBenchmarkMedia.file);
		const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
		await card.getByRole('button', { name: /Add to timeline/u }).click();
		const projectId = await editor.getAttribute('data-project-id');
		await chooseNestedCommandAction(page, editor, 'View', ['Video preview resolution', quality]);
		const clip = editor.getByRole('group', { name: /^Video clip:/u }).first(); await clip.press('Enter');
		await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
		const preview = editor.locator('[data-video-preview]');
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
		else await expect(dialog.getByRole('status')).toHaveText('The evaluated freeze preview is stale. Wait for the playhead frame and retry.');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await chooseCommandAction(page, editor, 'File', 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const output = await page.evaluate(async ({ name, id }) => {
			const request = input => new Promise((resolve, reject) => { input.onsuccess = () => resolve(input.result); input.onerror = () => reject(input.error); });
			const db = await request(indexedDB.open(name));
			try { const project = await request(db.transaction('projects').objectStore('projects').get(id));
				return project.sources.filter(source => source.kind === 'still').map(({ width, height, contentSha256 }) => ({ width, height, contentSha256 })); }
			finally { db.close(); }
		}, { name: FRAMESCAPER_DATABASE_NAME, id: projectId });
		outputs.push(output);
		await test.info().attach('freeze-output-dimensions', { body: JSON.stringify(output), contentType: 'application/json' });
		if (exactPreviewAvailable) expect(output[0]).toMatchObject({ width: 1280, height: 720 });
		else expect(output).toEqual([]);
		expect(errors).toEqual([]);
	});
});
