/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';

test('the sidebar opens desktop delivery in a separate tab', async ({ page, context }) => {
	let requests = 0;
	// Node route tests prove installer selection and release redirects. Preview
	// has no Pages Functions, so prove the sidebar's tab behavior with a landing
	// document. WebKit's intercepted attachments omit download filename events.
	await context.route('https://soundscaper.org/download/desktop/', async route => {
		requests += 1;
		await route.fulfill({
			contentType: 'text/html',
			body: '<h1>Desktop installer delivery</h1>',
		});
	});
	await page.goto('/en/');
	const opening = context.waitForEvent('page');
	await page.getByRole('link', { name: 'Download', exact: true }).click();
	const delivery = await opening;
	await expect(delivery).toHaveURL('https://soundscaper.org/download/desktop/');
	await expect(delivery.getByRole('heading', { name: 'Desktop installer delivery' })).toBeVisible();
	expect(requests).toBe(1);
	await expect(page).toHaveURL(/\/en\/$/);
	await expect(page.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
});
