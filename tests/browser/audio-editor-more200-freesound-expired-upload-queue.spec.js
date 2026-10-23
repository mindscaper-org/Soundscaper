/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { mockFreesoundApi } from './helpers/guide-freesound.js';

for (const firstStatus of [401, 503]) test(`Freesound ${firstStatus} ${firstStatus === 401 ? 'pauses queued file uploads until reconnection' : 'does not stop healthy later uploads'}`, async ({ page }) => {
	await mockFreesoundApi(page);
	const uploads = [];
	let reconnected = false;
	await page.route('**/api/freesound/oauth/session', route => route.fulfill({ json: { data: { connected: true, user: { username: 'recorder' } } } }));
	await page.route('**/api/freesound/uploads/pending', route => route.fulfill({ json: { data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } } }));
	await page.route('**/api/freesound/uploads', async route => {
		const name = decodeURIComponent(route.request().headers()['x-freesound-filename']);
		uploads.push(name);
		if (uploads.length === 1 || firstStatus === 401 && !reconnected) {
			await route.fulfill({ status: firstStatus, json: { error: { code: firstStatus === 401 ? 'not_authenticated' : 'unavailable', message: 'Upload failed.' } } });
		} else await route.fulfill({ json: { data: { uploadFilename: name } } });
	});
	await page.route('**/api/freesound/oauth/start', route => route.fulfill({ json: { data: {
		attemptId: 'retry', handoffToken: 'retry-handoff', expiresAt: new Date(Date.now() + 60_000).toISOString(),
		authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=ordinary&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback&response_type=code&state=retry',
	} } }));
	await page.route('**/api/freesound/oauth/poll', route => {
		reconnected = true;
		return route.fulfill({ json: { data: { connected: true, user: { username: 'recorder' } } } });
	});
	await page.context().route('https://freesound.org/apiv2/oauth2/authorize/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Connect</title>' }));
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as recorder', { exact: true })).toBeVisible();
	const queue = panel.locator('[data-freesound-uploads="true"]');
	await queue.getByText('Upload to Freesound', { exact: true }).click();
	await queue.locator('input[type="file"]').setInputFiles([1, 2, 3].map(index => createWavFixture({ name: `Take-${index}.wav`, duration: .1 })));
	if (firstStatus === 401) {
		const connect = panel.getByRole('button', { name: 'Connect to Freesound', exact: true });
		await expect(connect).toBeVisible();
		await page.waitForTimeout(250);
		expect(uploads).toEqual(['Take-1.wav']);
		const popupReady = page.waitForEvent('popup'); await connect.click();
		const popup = await popupReady;
		await expect(panel.getByText('Connected as recorder', { exact: true })).toBeVisible(); await popup.close();
		if (!await queue.evaluate(element => element.open)) await queue.getByText('Upload to Freesound', { exact: true }).click();
	}
	await expect(queue.locator('[data-upload-status="ready-to-publish"]')).toHaveCount(2);
	expect(uploads).toEqual(['Take-1.wav', 'Take-2.wav', 'Take-3.wav']);
	await queue.getByRole('button', { name: /^Retry.*Take-1\.wav/u }).click();
	await expect(queue.locator('[data-upload-status="ready-to-publish"]')).toHaveCount(3);
	expect(uploads).toEqual(['Take-1.wav', 'Take-2.wav', 'Take-3.wav', 'Take-1.wav']);
});
