/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const status of [401, 500]) test(`audio.com original preview HTTP${status} updates the account appropriately`, async ({ page }) => {
	let previews = 0;
	await page.route('**/api/audiocom/**', async route => {
		const url = new URL(route.request().url());
		if (url.pathname === '/api/audiocom/preview') {
			previews++; return route.fulfill({ status, json: { error: { message: 'Original unavailable.' } } });
		}
		const data = url.pathname.endsWith('/oauth/session') ? { connected: true }
			: url.pathname.endsWith('/search') ? { page: 1, hasNext: false, results: [{
				id: '123', title: 'Original recording', authorName: 'Recorder', username: 'recorder',
				url: 'https://audio.com/recorder/audio/recording', description: '', license: 'arr',
				isDownloadable: false, durationSeconds: 1, previewMime: 'audio/aiff',
				previewUrl: '/api/audiocom/preview?url=https%3A%2F%2Faudio.com%2Frecording.aiff',
			}] } : { projectStorageSupported: false };
		return route.fulfill({ json: { data } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
	const panel = editor.locator('[data-workspace-panel="audiocom"]');
	await expect(panel.getByText('Connected to audio.com', { exact: true })).toBeVisible();
	await panel.getByRole('searchbox', { name: 'Search audio.com', exact: true }).fill('recording');
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	await panel.getByRole('button', { name: 'Play preview: Original recording', exact: true }).click();
	await expect.poll(() => previews).toBe(1);
	if (status === 401) {
		await expect(panel.getByRole('button', { name: 'Connect to audio.com', exact: true })).toBeVisible();
		await expect(panel.getByRole('alert')).toContainText('session expired');
		await expect(panel.locator('[data-audiocom-uploads]')).toHaveCount(0);
	} else {
		await expect(panel.getByText('Connected to audio.com', { exact: true })).toBeVisible();
		await expect(panel.getByRole('alert')).toContainText('could not be downloaded');
	}
});
