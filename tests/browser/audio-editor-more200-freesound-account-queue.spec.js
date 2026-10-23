/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { mockFreesoundApi } from './helpers/guide-freesound.js';

for (const changed of [false, true]) test(`Freesound account reconnection ${changed ? 'retires another account’s upload records' : 'retains its own uploaded and local files'}`, async ({ page }) => {
	await mockFreesoundApi(page);
	let reconnected = false;
	const user = () => changed && reconnected ? { id: 2, username: 'new-account' } : { id: 1, username: 'original-account' };
	await page.route('**/api/freesound/oauth/session', route => route.fulfill({ json: { data: { connected: true, user: user() } } }));
	await page.route('**/api/freesound/uploads/pending', route => route.fulfill({ json: { data: {
		pendingDescription: [changed && reconnected ? 'new-account.wav' : 'original-account.wav'], pendingProcessing: [], pendingModeration: [],
	} } }));
	await page.route('**/api/freesound/uploads', route => route.fulfill({ status: 401, json: { error: { code: 'not_authenticated', message: 'Login expired.' } } }));
	await page.route('**/api/freesound/oauth/start', route => route.fulfill({ json: { data: {
		attemptId: 'retry', handoffToken: 'retry-handoff', expiresAt: new Date(Date.now() + 60_000).toISOString(),
		authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=ordinary&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback&response_type=code&state=retry',
	} } }));
	await page.route('**/api/freesound/oauth/poll', route => {
		reconnected = true; return route.fulfill({ json: { data: { connected: true, user: user() } } });
	});
	await page.context().route('https://freesound.org/apiv2/oauth2/authorize/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Connect</title>' }));
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as original-account', { exact: true })).toBeVisible();
	const queue = panel.locator('[data-freesound-uploads="true"]');
	await queue.getByText('Upload to Freesound', { exact: true }).click();
	await expect(queue.locator('li[data-upload-status="ready-to-publish"]')).toContainText('original-account.wav');
	await queue.locator('input[type="file"]').setInputFiles(createWavFixture({ name: 'Original local.wav', duration: .1 }));
	const connect = panel.getByRole('button', { name: 'Connect to Freesound', exact: true }); await expect(connect).toBeVisible();
	const popupReady = page.waitForEvent('popup'); await connect.click(); const popup = await popupReady;
	await expect(panel.getByText(`Connected as ${changed ? 'new-account' : 'original-account'}`, { exact: true })).toBeVisible(); await popup.close();
	await queue.getByText('Upload to Freesound', { exact: true }).click();
	if (changed) {
		await expect(queue.locator('li')).toHaveCount(1);
		await expect(queue.locator('li')).toContainText('new-account.wav');
	} else {
		await expect(queue.locator('li')).toHaveCount(2);
		await expect(queue.locator('li[data-upload-status="ready-to-publish"]')).toContainText('original-account.wav');
		await expect(queue.locator('li[data-upload-status="failed"]')).toContainText('Original local.wav');
	}
});
