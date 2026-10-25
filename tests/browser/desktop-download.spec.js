/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';

test('the sidebar accepts an installer download while keeping the editor open', async ({ page, context }) => {
	const installer = 'Soundscaper-1.0.0-rc.Oct.25.a-win-x64.exe';
	let requests = 0;
	// Node route tests cover installer selection. Vite preview has no Pages
	// Functions, so emulate the final attachment for this browser interaction.
	await context.route('https://soundscaper.org/download/desktop/', async (route) => {
		requests += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/octet-stream',
			headers: { 'Content-Disposition': `attachment; filename="${installer}"` },
			body: 'test installer',
		});
	});
	await page.goto('/en/');
	const download = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Download', exact: true }).click();
	const downloaded = await download;
	expect(downloaded.suggestedFilename()).toBe(installer);
	expect(await downloaded.failure()).toBeNull();
	expect(requests).toBe(1);
	await expect(page).toHaveURL(/\/en\/$/);
});
