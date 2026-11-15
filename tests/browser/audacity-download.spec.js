/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { handleAudacityDownloadRequest } from '../../functions/download/audacity/index.ts';
import { handleDownloadPageRequest } from '../../functions/download/index.ts';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.describe('Audacity download pages', () => {
	test.use({ javaScriptEnabled: false, browserCoverage: false });

	test('local preview serves the new page family before the editor fallback', async ({ page }) => {
		const response = await page.goto(resolveBrowserProductTestUrl('/download/audacity/de/'));
		expect(response.status()).toBe(200);
		await expect(page.getByRole('heading', { name: 'Audacity und Soundscaper herunterladen', exact: true })).toBeVisible();
		await expect(page.getByRole('table')).toBeVisible();
	});

	test('the existing download menu opens the comparison and switches languages without JavaScript', async ({ page, context }) => {
		await mockPages(context);
		await page.goto('https://soundscaper.org/download/en/');
		await page.getByText('Other downloads', { exact: true }).click();
		await page.getByRole('link', { name: 'Download Audacity', exact: true }).click();
		await expect(page).toHaveURL('https://soundscaper.org/download/audacity/en/');
		await expect(page.getByRole('heading', { name: 'Download Audacity and Soundscaper', exact: true })).toBeVisible();
		const audacity4 = page.getByRole('article', { name: 'Audacity 4', exact: true });
		await audacity4.getByText('Other downloads for Audacity 4', { exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(audacity4.getByRole('link', { name: 'Windows · ARM64 · msi', exact: true })).toBeVisible();
		await expect(audacity4.getByRole('link', { name: 'Windows · ARM64 · msi', exact: true })).toHaveAttribute('href', /github\.com\/audacity\/audacity\/releases\/download\//);
		await page.getByText('Language', { exact: true }).click();
		await page.getByRole('link', { name: 'Français', exact: true }).click();
		await expect(page).toHaveURL('https://soundscaper.org/download/audacity/fr/');
		await expect(page.getByRole('heading', { name: 'Téléchargez Audacity et Soundscaper', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Ouvrir la version en ligne', exact: true })).toHaveAttribute('href', '/fr/');
	});

	test('Arabic menus and the comparison fit a narrow screen', async ({ page, context }) => {
		await mockPages(context);
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto('https://soundscaper.org/download/audacity/ar/');
		expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
		await expect(page.getByRole('table')).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.getByText('اللغة', { exact: true }).click();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await expect(page.getByRole('link', { name: 'العربية', exact: true })).toHaveAttribute('aria-current', 'page');
		await page.getByRole('link', { name: 'Deutsch', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Audacity und Soundscaper herunterladen', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Online-Version öffnen', exact: true })).toHaveAttribute('href', '/de/');
	});

	test('mobile visitors can open the primary package chooser without JavaScript', async ({ page, context }) => {
		await mockPages(context, { 'User-Agent': 'Mozilla/5.0 iPhone Mobile' });
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto('https://soundscaper.org/download/audacity/en/');
		const audacity4 = page.getByRole('article', { name: 'Audacity 4', exact: true });
		await audacity4.getByText(/^Download Audacity [0-9.]+ ↓$/).click();
		await expect(audacity4.getByRole('link', { name: 'Windows · ARM64 · msi', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Open online version', exact: true })).toHaveAttribute('href', '/en/');
	});
});

test('download cards and comparison pass accessibility checks in light and dark themes', async ({ page, context }) => {
	await mockPages(context);
	for (const [locale, colorScheme] of [['de', 'light'], ['ar', 'dark']]) {
		await page.emulateMedia({ colorScheme });
		await page.goto(`https://soundscaper.org/download/audacity/${locale}/`);
		const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
		expect(result.violations).toEqual([]);
	}
});

async function mockPages(context, headers = { 'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Arch': '"x86"', 'Sec-CH-UA-Bitness': '"64"' }) {
	await context.route('https://soundscaper.org/download/**', async route => {
		const request = new Request(route.request().url(), { headers });
		const handler = request.url.includes('/download/audacity/') ? handleAudacityDownloadRequest : handleDownloadPageRequest;
		const response = await handler(request, async () => Response.json([{
			tag_name: 'Soundscaper-rc.2026.Nov.15.a', draft: false, published_at: '2026-11-15T00:00:00Z',
			assets: [{ name: 'Soundscaper-rc.2026.Nov.15.a-win-x64.exe', state: 'uploaded' }],
		}]));
		await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
	});
	await context.route('https://soundscaper.org/*.css', async route => {
		const { readFile } = await import('node:fs/promises');
		const name = new URL(route.request().url()).pathname.slice(1);
		await route.fulfill({ contentType: 'text/css', body: await readFile(new URL(`../../public/${name}`, import.meta.url), 'utf8') });
	});
	await context.route('https://soundscaper.org/logo/*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }));
}
