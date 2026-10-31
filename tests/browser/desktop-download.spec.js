/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { handleDownloadPageRequest } from '../../functions/download/index.ts';

test('the sidebar opens the download page in a separate tab', async ({ page, context }) => {
	let requests = 0;
	// Node route tests prove installer selection and release redirects. Preview
	// has no Pages Functions, so prove the sidebar's tab behavior with a landing
	// document. WebKit's intercepted attachments omit download filename events.
	await context.route('https://soundscaper.org/download/', async route => {
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
	await expect(delivery).toHaveURL('https://soundscaper.org/download/');
	await expect(delivery.getByRole('heading', { name: 'Desktop installer delivery' })).toBeVisible();
	expect(requests).toBe(1);
	await expect(page).toHaveURL(/\/en\/$/);
	await expect(page.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
});

test.describe('release candidate download pages', () => {
	test.use({ javaScriptEnabled: false });
	for (const product of ['Soundscaper', 'Framescaper']) {
		test(`${product} offers its current RC on desktop and narrow screens without JavaScript`, async ({ page, context }) => {
			const id = product.toLowerCase();
			const origin = `https://${id}.org`;
			const version = '1.0.0-rc.Oct.29.b';
			await mockDownloadPage(context, product);
			await page.goto(`${origin}/download/`);
			await expect(page.getByRole('heading', { name: `Download ${product}`, exact: true })).toBeVisible();
			await expect(page.getByRole('heading', { name: version, exact: true })).toBeVisible();
			for (const platform of ['Windows', 'macOS', 'Linux']) {
				await expect(page.getByRole('heading', { name: platform, exact: true })).toBeVisible();
			}
			await expect(page.getByRole('link', { name: 'Windows x64 installer' })).toHaveAttribute('href',
				`https://github.com/LeoWattenberg/Soundscaper/releases/download/${id}-v${version}/${product}-${version}-win-x64.exe`);
			await expect(page.getByRole('link', { name: 'Windows ARM64 installer' })).toHaveCount(0);
			await page.setViewportSize({ width: 375, height: 812 });
			await expect(page.getByRole('link', { name: 'Linux ARM64 AppImage' })).toBeVisible();
			await expect(page.getByRole('link', { name: `Open ${product}`, exact: true })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		});
	}
});

test('download pages are accessible in light and dark mode', async ({ page, context }) => {
	for (const product of ['Soundscaper', 'Framescaper']) {
		await mockDownloadPage(context, product);
		await page.goto(`https://${product.toLowerCase()}.org/download/`);
		for (const colorScheme of ['light', 'dark']) {
			await page.emulateMedia({ colorScheme });
			const accessibility = await new AxeBuilder({ page }).analyze();
			expect(accessibility.violations).toEqual([]);
		}
	}
});

async function mockDownloadPage(context, product) {
	const id = product.toLowerCase();
	const origin = `https://${id}.org`;
	const version = '1.0.0-rc.Oct.29.b';
	const assets = ['win-x64.exe', 'mac-arm64.dmg', 'linux-arm64.AppImage'].map(target => ({
		name: `${product}-${version}-${target}`, state: 'uploaded',
	}));
	// The preview serves static files; render the actual Function with a
	// fixed feed so browser checks remain independent of GitHub availability.
	await context.route(`${origin}/download/`, async route => {
		const response = await handleDownloadPageRequest(new Request(route.request().url()), async () => Response.json([{
			tag_name: `${id}-v${version}`, published_at: '2026-10-30T12:00:00Z', draft: false, assets,
		}]));
		await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
	});
	await context.route(`${origin}/download.css`, async route => {
		await route.fulfill({ contentType: 'text/css', body: await readFile(new URL('../../public/download.css', import.meta.url), 'utf8') });
	});
	await context.route(`${origin}/logo/${id}.svg`, async route => {
		await route.fulfill({ contentType: 'image/svg+xml', body: await readFile(new URL(`../../public/logo/${id}.svg`, import.meta.url), 'utf8') });
	});
}
