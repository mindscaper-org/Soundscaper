/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { mockFreesoundApi } from './helpers/guide-freesound.js';

test('Freesound stops offering file uploads as soon as Disconnect is chosen', async ({ page }) => {
	await mockFreesoundApi(page);
	let release;
	const delayed = new Promise(resolve => { release = resolve; });
	let requested;
	const started = new Promise(resolve => { requested = resolve; });
	await page.route('**/api/freesound/oauth/session', async route => {
		if (route.request().method() === 'DELETE') {
			requested(); await delayed;
			await route.fulfill({ status: 204 });
		} else await route.fulfill({ json: { data: { connected: true, user: { username: 'recorder' } } } });
	});
	await page.route('**/api/freesound/uploads/pending', route => route.fulfill({
		json: { data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } },
	}));
	const uploaded = [];
	await page.route('**/api/freesound/uploads', async route => {
		uploaded.push(route.request().headers()['x-freesound-filename']);
		await route.fulfill({ json: { data: { uploadFilename: 'after-disconnect.wav' } } });
	});
	try {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Window', 'Freesound');
		const panel = editor.locator('[data-workspace-panel="freesound"]');
		await expect(panel.getByText('Connected as recorder', { exact: true })).toBeVisible();
		const uploads = panel.locator('[data-freesound-uploads="true"]');
		await uploads.getByText('Upload to Freesound', { exact: true }).click();
		await expect(uploads.locator('input[type="file"]')).toBeEnabled();
		await panel.getByRole('button', { name: 'Disconnect', exact: true }).click(); await started;
		if (await uploads.count()) {
			await uploads.locator('input[type="file"]').setInputFiles(createWavFixture({ name: 'After disconnect.wav', duration: .1 }));
			await expect.poll(() => uploaded.length).toBe(1);
		}
		expect(uploaded).toHaveLength(0);
		await expect(uploads).toHaveCount(0);
		release();
		await expect(panel.getByRole('button', { name: 'Connect to Freesound', exact: true })).toBeVisible();
	} finally { release(); }
});
