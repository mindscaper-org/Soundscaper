/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { test, expect } from './helpers/browser-coverage-fixture.js';

// This route serves the diagnostic launcher's renderer, outside the product sites.
test.use({ browserCoverage: false });

test('nightly Test suite menu pauses, waits for cancellation, and offers Resume', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The nightly progress window runs in Electron Chromium.');
	const requests = [];
	const root = new URL('../../desktop/', import.meta.url);
	await page.route('**/__nightly-progress__/**', async (route) => {
		const path = new URL(route.request().url()).pathname.split('/__nightly-progress__/')[1];
		const file = path || 'nightly-tests-progress.html';
		const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
		await route.fulfill({ contentType, body: await readFile(new URL(file, root)) });
	});
	await page.goto('/__nightly-progress__/');
	await page.exposeFunction('nightlyControl', (action) => { requests.push(action); });
	// Electron intercepts these navigations in will-navigate. Keep the same
	// document alive while exercising the renderer in ordinary Chromium.
	await page.evaluate(() => {
		globalThis.navigation.addEventListener('navigate', (event) => {
			const path = new URL(event.destination.url).pathname.split('/__nightly-progress__/')[1];
			if (!path?.startsWith('__control__/')) return;
			event.preventDefault();
			void globalThis.nightlyControl(path);
		});
	});
	const menu = page.locator('summary', { hasText: 'Test suite' });
	await menu.click();
	const pause = page.getByRole('menuitem', { name: 'Pause', exact: true });
	await expect(pause).toBeDisabled();
	const render = async (label) => {
		await page.evaluate((value) => {
			globalThis.renderNightlyTestsProgress({ completed: 2, total: 6, label: value,
				items: { completed: 3, total: 8, label: 'Current test' } });
		}, label);
	};
	await render('Performance diagnostics');
	await expect(pause).toBeEnabled();
	await pause.click();
	await expect.poll(() => requests).toEqual(['__control__/pause']);
	await render('Pausing tests…');
	await expect(pause).toBeDisabled();
	await expect(page.getByRole('status').first()).toHaveText('Pausing tests…');
	await render('Tests paused');
	const resume = page.getByRole('menuitem', { name: 'Resume', exact: true });
	await expect(resume).toBeEnabled();
	await expect(page.locator('#phase-count-2')).toHaveText('3 of 8 tests complete');
	await resume.click();
	await expect.poll(() => requests).toEqual(['__control__/pause', '__control__/resume']);
	await render('Performance diagnostics');
	await expect(pause).toBeEnabled();
	await render('Tests finished with failures');
	await expect(pause).toBeDisabled();
});
