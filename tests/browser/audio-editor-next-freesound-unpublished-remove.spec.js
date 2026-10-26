/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('unpublished Freesound rows can be removed to make room without publishing them', async ({ page }) => {
	let publications = 0;
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/describe')) publications++;
		const data = path.endsWith('/oauth/session') ? { connected: true, user: { username: 'field-recorder' } }
			: path.endsWith('/uploads/pending') ? {
				pendingDescription: Array.from({ length: 100 }, (_, index) => `unpublished-${index}.wav`),
				pendingProcessing: [], pendingModeration: [],
			} : { uploadFilename: toneA.name };
		await route.fulfill({ json: { data } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Freesound']);
	const uploads = editor.locator('[data-freesound-uploads="true"]');
	await uploads.getByText('Upload to Freesound', { exact: true }).click();
	await expect(uploads.locator('li')).toHaveCount(100);
	await uploads.locator('li').first().getByRole('button', { name: /^Remove/u }).click();
	await expect(uploads.locator('li')).toHaveCount(99);
	await uploads.locator('input[type="file"]').setInputFiles(toneA);
	await expect(uploads.locator('li')).toHaveCount(100);
	await expect(uploads.locator('li').filter({ hasText: toneA.name })).toHaveAttribute('data-upload-status', 'ready-to-publish');
	expect(publications).toBe(0);
});
