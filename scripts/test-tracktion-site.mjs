/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright-core';

import { verifyTracktionNarrowMenus } from './lib/tracktion-narrow-menus-check.ts';
import { verifyTracktionWebEditor } from './lib/tracktion-web-editor-check.ts';

const site = new URL(process.argv[2] ?? 'http://127.0.0.1:4321/en/');
for (const browserType of [chromium, firefox, webkit]) {
	const browser = await browserType.launch();
	try {
		const page = await browser.newPage();
		const engineRequests = [];
		page.on('request', (request) => {
			if (new URL(request.url()).pathname.startsWith('/tracktion/')) engineRequests.push(request.url());
		});
		await page.goto(site.href);
		await page.getByRole('heading', { name: 'Soundscaper Tracktion' }).waitFor();
		assert.equal(await page.evaluate(() => crossOriginIsolated), true);
		assert.deepEqual(engineRequests, [], 'the idle Soundscaper site must defer loading the native engine');
		const editing = page.getByText('Editing tools', { exact: true });
		await editing.click();
		await page.getByText('File', { exact: true }).click();
		assert.equal(await editing.locator('..').getAttribute('open'), null, 'opening File closes the Editing tools menu');
		await page.getByRole('button', { name: 'Open projects', exact: true }).click();
		const chooser = page.getByRole('dialog', { name: 'Local projects' });
		await chooser.getByRole('button', { name: 'Cancel', exact: true }).click();
		await chooser.waitFor({ state: 'detached' });
		assert.deepEqual(engineRequests, [], 'browsing the local project list must not load the native engine');
		await verifyTracktionWebEditor(page, site.origin, site.pathname);
		assert.ok(engineRequests.some((url) => url.endsWith('/tracktion/edit-core.wasm')), 'the regular site must run the Tracktion WASM core');
		await page.close();
		const narrow = await browser.newPage({ viewport: { width: 320, height: 650 }, hasTouch: true, isMobile: browserType !== firefox });
		await verifyTracktionNarrowMenus(narrow, site);
		console.log(`${browserType.name()} passed the regular Soundscaper site workflow.`);
	} finally {
		await browser.close();
	}
}
