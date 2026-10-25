/* SPDX-License-Identifier: AGPL-3.0-only */

import { handleDesktopDownloadRequest } from '../../functions/download/desktop/index.ts';
import { expect, test } from './audio-editor-test-fixtures.js';

test.use({
	userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36',
	extraHTTPHeaders: { 'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Arch': '"x86"', 'Sec-CH-UA-Bitness': '"64"' },
});

test('Download starts the latest Windows installer from the existing sidebar link', async ({ page, context }) => {
	const installer = 'Soundscaper-1.0.0-rc.Oct.25.a-win-x64.exe';
	const destinations = [];
	const fetchReleases = async () => Response.json([{
		tag_name: 'soundscaper-v1.0.0-rc.Oct.25.a', published_at: '2026-10-25T00:00:00Z', draft: false,
		assets: [{ name: installer, state: 'uploaded' }],
	}]);
	// Vite preview serves the site. Run the Pages resolver at the production
	// origin, then stand in for GitHub's attachment response without fetching it.
	await context.route('https://soundscaper.org/download/desktop/', async (route) => {
		const request = route.request();
		const response = await handleDesktopDownloadRequest(new Request(request.url(), {
			headers: await request.allHeaders(),
		}), fetchReleases);
		const location = response.headers.get('location');
		destinations.push(location);
		expect(response.status).toBe(302);
		expect(location).toBe(`https://github.com/LeoWattenberg/Soundscaper/releases/download/soundscaper-v1.0.0-rc.Oct.25.a/${installer}`);
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
	expect(destinations).toEqual([
		`https://github.com/LeoWattenberg/Soundscaper/releases/download/soundscaper-v1.0.0-rc.Oct.25.a/${installer}`,
	]);
	await expect(page).toHaveURL(/\/en\/$/);
});
