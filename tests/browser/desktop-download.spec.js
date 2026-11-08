/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { handleDownloadPageRequest } from '../../functions/download/index.ts';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

for (const [name, path] of [['Soundscaper', '/download/'], ['Framescaper', '/framescaper/download/']]) {
	test(`local preview serves the ${name} download page without a route mock`, async ({ page }) => {
		const response = await page.goto(resolveBrowserProductTestUrl(path));
		// GitHub may be unavailable; the page must still render its retry state.
		expect([200, 503]).toContain(response.status());
		await expect(page.getByRole('heading', { name: `Download ${name}`, exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: `Open ${name}`, exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Handbook', exact: true })).toHaveAttribute('href', '/docs/');
	});
}

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
	// Chromium cannot start its JavaScript profiler with script execution disabled.
	test.use({ javaScriptEnabled: false, browserCoverage: false });
	for (const product of ['Soundscaper', 'Framescaper']) {
		test(`${product} offers its current RC on desktop and narrow screens without JavaScript`, async ({ page, context }) => {
			const id = product.toLowerCase();
			const origin = `https://${id}.org`;
			const version = '1.0.0-rc.Oct.29.b';
			await context.setExtraHTTPHeaders({
				'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Arch': '"x86"', 'Sec-CH-UA-Bitness': '"64"',
			});
			await mockDownloadPage(context, product);
			await page.goto(`${origin}/download/`);
			await expect(page.getByRole('heading', { name: `Download ${product}`, exact: true })).toBeVisible();
			await expect(page.getByText(version, { exact: false })).toBeVisible();
			await expect(page.getByText('October 30, 2026', { exact: true })).toBeVisible();
			await expect(page.getByRole('link', { name: 'macOS Apple silicon DMG' })).not.toBeVisible();
			await page.getByText('Other downloads', { exact: true }).focus();
			await page.keyboard.press('Enter');
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

for (const [label, platform, architecture, matching] of [
	['Windows x64', 'Windows', 'x86', ['Windows x64 installer', 'Windows x64 portable ZIP']],
	['Windows ARM64', 'Windows', 'arm', ['Windows ARM64 installer']],
	['Linux ARM64', 'Linux', 'arm', ['Linux ARM64 AppImage']],
	['Apple silicon', 'macOS', 'arm', ['macOS Apple silicon PKG installer', 'macOS Apple silicon DMG']],
]) {
	test(`${label} detection puts only matching packages above Other downloads`, async ({ page, context }) => {
		await context.setExtraHTTPHeaders({
			'Sec-CH-UA-Platform': `"${platform}"`, 'Sec-CH-UA-Arch': `"${architecture}"`, 'Sec-CH-UA-Bitness': '"64"',
		});
		const labels = ['Windows x64 installer', 'Windows ARM64 installer', 'Windows x64 portable ZIP',
			'macOS Apple silicon PKG installer', 'macOS Apple silicon DMG', 'Linux x64 AppImage', 'Linux ARM64 AppImage'];
		await mockDownloadPage(context, 'Soundscaper',
			['win-x64.exe', 'win-arm64.exe', 'win-x64.zip', 'mac-arm64.pkg', 'mac-arm64.dmg', 'linux-x64.AppImage', 'linux-arm64.AppImage']);
		await page.goto('https://soundscaper.org/download/');
		for (const name of labels) {
			const link = page.getByRole('link', { name, exact: true });
			if (matching.includes(name)) await expect(link).toBeVisible();
			else await expect(link).not.toBeVisible();
		}
		const resources = page.getByRole('navigation', { name: 'Release resources' });
		await expect(resources.getByRole('link', { name: 'Release notes', exact: true })).toBeVisible();
		await expect(resources.getByRole('link', { name: 'Checksums', exact: true })).toBeVisible();
		await page.getByText('Other downloads', { exact: true }).click();
		for (const name of labels) await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
		await page.getByText('Other downloads', { exact: true }).click();
		for (const name of labels.filter(name => !matching.includes(name))) {
			await expect(page.getByRole('link', { name, exact: true })).not.toBeVisible();
		}
	});
}

test('download pages are accessible in light and dark mode', async ({ page, context }) => {
	await context.setExtraHTTPHeaders({
		'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Arch': '"x86"', 'Sec-CH-UA-Bitness': '"64"',
	});
	for (const product of ['Soundscaper', 'Framescaper']) {
		await mockDownloadPage(context, product);
		await page.goto(`https://${product.toLowerCase()}.org/download/`);
		for (const colorScheme of ['light', 'dark']) {
			await page.emulateMedia({ colorScheme });
			const accessibility = await new AxeBuilder({ page }).analyze();
			expect(accessibility.violations).toEqual([]);
			await page.getByText('Other downloads', { exact: true }).click();
			expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
			await page.getByText('Other downloads', { exact: true }).click();
		}
	}
});

async function mockDownloadPage(context, product, targets = ['win-x64.exe', 'mac-arm64.pkg', 'mac-arm64.dmg', 'linux-arm64.AppImage']) {
	const id = product.toLowerCase();
	const origin = `https://${id}.org`;
	const version = '1.0.0-rc.Oct.29.b';
	const assets = targets.map(target => ({
		name: `${product}-${version}-${target}`, state: 'uploaded',
	}));
	assets.push({ name: 'SHA256SUMS', state: 'uploaded' });
	// Use fixed release data for layout checks. The tests above exercise local
	// preview routing without intercepting the download page.
	await context.route(`${origin}/download/`, async route => {
		const request = new Request(route.request().url(), { headers: route.request().headers() });
		const response = await handleDownloadPageRequest(request, async () => Response.json([{
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
