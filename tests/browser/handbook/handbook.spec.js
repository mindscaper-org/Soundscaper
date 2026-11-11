import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test } from '../audio-editor-test-fixtures.js';

import { handbookPlan } from '../../../scripts/lib/product-web-routing.mjs';

// The handbook is served from a path on the product origin, so every route in
// this suite carries the base the deployment serves it under - in the URLs it
// navigates to and in the URLs it expects a followed link to land on. A link
// authored root-absolute in Markdown is rebased at build time, and asserting
// the base is how a link that missed that rebase is caught here rather than in
// production, where it would land on the editor instead of a handbook page.
const BASE = handbookPlan('soundscaper').scope;

test('publishes only Soundscaper tutorials on the Soundscaper origin', async ({ page }) => {
	await page.goto(BASE);
	await expect(page.getByRole('heading', { level: 1, name: 'Soundscaper Handbook' })).toBeVisible();
	await expect(page.getByRole('link', { name: /Framescaper/u })).toHaveCount(0);
	const foreignTutorial = await page.request.get(`${BASE}framescaper/first-project/`);
	expect(foreignTutorial.status()).toBe(404);
	const sharedChooser = await page.request.get(`${BASE}start/choose-an-editor/`);
	expect(sharedChooser.status()).toBe(404);
	await page.goto(`${BASE}soundscaper/edit-mix-and-export/`);
	await expect(page.locator('a[href*="framescaper.org/docs"]')).toHaveCount(0);
	await page.goto(BASE);
	await page.getByRole('link', { name: 'Start the first tutorial' }).click();
	await expect(page).toHaveURL(new RegExp(`${BASE}tutorials/your-first-project/$`, 'u'));
});

test('starts a newcomer on a tutorial and hands them on to the how-to guides', async ({ page }) => {
	await page.goto(`${BASE}tutorials/`);
	await expect(page.getByRole('heading', { level: 1, name: 'Tutorials' })).toBeVisible();
	await page.getByRole('link', { name: 'Your first Soundscaper project' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}tutorials/your-first-project/$`, 'u'));
	// The example the tutorial is a lesson on is handed to the reader, not
	// merely named, and it comes from the assets bucket rather than the site.
	await expect(page.getByRole('link', { name: 'guide-music-loop.wav' })).toHaveAttribute('href', /^https:\/\/assets\.soundscaper\.org\/guides\/examples\/guide-music-loop\.wav$/u);
	await page.getByRole('link', { name: 'Fade in and fade out' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/fade-in-and-fade-out/$`, 'u'));
});

test('reaches a guide through its category, and back out again', async ({ page }) => {
	await page.goto(`${BASE}guides/`);
	await expect(page.getByRole('heading', { level: 1, name: 'How-to guides' })).toBeVisible();

	// The index groups the guides by category, and each category heading is a
	// link to the category's own page rather than a bare label.
	await page.getByRole('heading', { level: 2, name: 'Volume and dynamics' }).getByRole('link').click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/$`, 'u'));
	await expect(page.getByRole('heading', { level: 1, name: 'Volume and dynamics' })).toBeVisible();

	await page.getByRole('link', { name: 'Normalize peaks to a set level' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/normalize-peaks/$`, 'u'));
	await expect(page.getByRole('heading', { level: 1, name: 'Normalize peaks to a set level' })).toBeVisible();

	// Every guide leads back to the rest of its category and on to a related one.
	await page.getByRole('link', { name: 'Even out volume with a compressor' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/even-out-volume-with-a-compressor/$`, 'u'));
});

test('local search indexes generated runtime references without cross-origin requests', async ({ page, baseURL }) => {
	const firstPartyOrigin = new URL(baseURL).origin;
	const crossOriginRequests = [];
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (/^https?:$/u.test(url.protocol) && url.origin !== firstPartyOrigin) crossOriginRequests.push(url.href);
	});
	await page.goto(BASE);
	await page.getByRole('button', { name: 'Search' }).click();
	await page.getByPlaceholder('Search').fill('WavPack');
	const dialog = page.getByRole('dialog', { name: 'Search' });
	await expect(dialog.getByText(/\d+ results? for WavPack/u)).toBeVisible();
	await dialog.getByRole('link', { name: 'Export formats' }).click();
	await expect(page).toHaveURL(new RegExp(`${BASE}reference/generated/formats/$`, 'u'));
	await expect(page.getByRole('cell', { name: 'WavPack', exact: true })).toBeVisible();
	expect(crossOriginRequests).toEqual([]);
});

test('mobile readers can navigate the handbook sidebar', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`${BASE}soundscaper/recording/`);
	await page.getByRole('button', { name: /menu/iu }).click();
	await page.getByRole('link', { name: 'Storage, backups, and privacy' }).click();
	await expect(page).toHaveURL(new RegExp(`${BASE}projects-and-data/storage-backups-and-privacy/$`, 'u'));
});

test('states a local model purpose and keeps packaged-test mechanics collapsed', async ({ page }) => {
	await page.goto(`${BASE}reference/local-models/silero-vad-v6/`);
	await expect(page.getByRole('heading', { level: 2, name: 'Purpose and use case' })).toBeVisible();
	const disclosure = page.locator('details#what-the-packaged-test-checks');
	await expect(disclosure).not.toHaveAttribute('open', '');
	await expect(disclosure.getByText(/silero-voice-activity/u)).toBeHidden();
	await disclosure.locator('summary').click();
	await expect(disclosure.getByText(/silero-voice-activity/u)).toBeVisible();
});

test('gives the comparison page full width while standard pages keep their reading layout', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto(`${BASE}start/how-soundscaper-compares/`);
	const comparisonTitle = page.getByRole('heading', { level: 1, name: 'How Soundscaper compares' });
	await expect(comparisonTitle).toBeVisible();
	const comparisonWidth = (await comparisonTitle.boundingBox()).width;
	expect(comparisonWidth).toBeGreaterThan(900);
	const sidebarLink = page.getByRole('navigation', { name: 'Main', exact: true })
		.getByRole('link', { name: 'How Soundscaper compares', exact: true });
	const contents = page.getByRole('navigation', { name: 'On this page', exact: true });
	await expect(sidebarLink).toBeVisible();
	await expect(contents).toBeVisible();
	for (const width of [1600, 2400]) {
		await page.setViewportSize({ width, height: 1000 });
		const titleBox = await comparisonTitle.boundingBox();
		const sidebarBox = await sidebarLink.boundingBox();
		const contentsBox = await contents.boundingBox();
		expect(titleBox.x - (sidebarBox.x + sidebarBox.width)).toBeLessThanOrEqual(64);
		expect(contentsBox.x - (titleBox.x + titleBox.width)).toBeLessThanOrEqual(64);
		expect(contentsBox.width).toBeLessThanOrEqual(300);
		let referenceColumns;
		for (const table of await page.getByRole('table').all()) {
			const columns = await table.getByRole('columnheader').evaluateAll((headers) => headers.filter((header) => header.scope === 'col').map((header) => {
				const { x, width: columnWidth } = header.getBoundingClientRect();
				return { x, width: columnWidth };
			}));
			referenceColumns ??= columns;
			expect(columns).toHaveLength(referenceColumns.length);
			for (const [index, column] of columns.entries()) {
				expect(column.x).toBeCloseTo(referenceColumns[index].x, 0);
				expect(column.width).toBeCloseTo(referenceColumns[index].width, 0);
			}
			expect((await table.boundingBox()).width).toBeGreaterThanOrEqual(titleBox.width - 1);
		}
	}

	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto(`${BASE}soundscaper/recording/`);
	const standardTitle = page.getByRole('heading', { level: 1 });
	await expect(standardTitle).toBeVisible();
	expect((await standardTitle.boundingBox()).width).toBeLessThan(comparisonWidth - 180);
	await expect(page.getByRole('navigation', { name: 'On this page', exact: true })).toBeVisible();

	for (const width of [1280, 390]) {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${BASE}start/how-soundscaper-compares/`);
		await expect(comparisonTitle).toBeVisible();
		await expect(page.getByRole('navigation', { name: /^On this page/u })).toBeVisible();
		const pageWidth = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
		expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport);
		const comparisonScroll = page.getByRole('region', { name: 'Platform and terms', exact: true });
		const scrollBox = await comparisonScroll.boundingBox();
		const feature = comparisonScroll.getByRole('rowheader').first();
		await comparisonScroll.focus();
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => comparisonScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
		await expect(feature).toBeVisible();
		expect((await feature.boundingBox()).x).toBeCloseTo(scrollBox.x, 0);
		await comparisonScroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
		const focusLabel = comparisonScroll.getByText('MIDI focus', { exact: true });
		const featureBox = await feature.boundingBox();
		expect((await focusLabel.boundingBox()).x).toBeGreaterThanOrEqual(featureBox.x + featureBox.width);
	}
});

test('renders comparison verdicts as accessible symbols with distinct colours', async ({ page }) => {
	await page.goto(`${BASE}start/how-soundscaper-compares/`);
	await expect(page.getByRole('heading', { level: 1, name: 'How Soundscaper compares' })).toBeVisible();
	const tables = page.getByRole('table');
	expect(await tables.count()).toBeGreaterThan(0);
	const colours = [];
	for (const [symbol, label] of [['+', 'Supported'], ['~', 'Limited'], ['/', 'Unavailable']]) {
		const verdict = tables.getByRole('img', { name: label, exact: true }).first();
		await expect(verdict).toHaveText(symbol);
		await expect(verdict).toBeVisible();
		colours.push(await verdict.evaluate((element) => getComputedStyle(element).color));
	}
	expect(new Set(colours).size).toBe(3);
});

test('keeps comparison sources collapsed and reveals cell details on hover, focus, and tap', async ({ page, isMobile }) => {
	await page.goto(`${BASE}start/how-soundscaper-compares/`);
	const sources = page.getByText('Where these claims come from', { exact: true });
	const releaseNotes = page.getByRole('link', { name: 'release notes', exact: true });
	await expect(releaseNotes).toBeHidden();
	await sources.click();
	await expect(releaseNotes).toBeVisible();
	await sources.click();
	await expect(releaseNotes).toBeHidden();

	const note = page.getByRole('table').getByRole('button').first();
	const detail = page.getByRole('tooltip', { includeHidden: true }).first();
	const explanation = await detail.textContent();
	await expect(detail).toBeHidden();
	await note.hover();
	await expect(detail).toBeVisible();
	await detail.hover();
	await expect(detail).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(detail).toBeHidden();
	await note.focus();
	await expect(detail).toBeVisible();
	await expect(note).toHaveAccessibleDescription(explanation);
	await page.keyboard.press('Escape');
	await expect(detail).toBeHidden();
	if (isMobile) await note.tap();
	else await note.click();
	await expect(detail).toBeVisible();
	await page.getByRole('heading', { level: 1 }).click();
	await expect(detail).toBeHidden();

	const accessibility = await new AxeBuilder({ page }).include('main').analyze();
	expect(accessibility.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});

// The generated reference pages carry the widest and longest tables in the
// handbook, so one of each shape is checked: a short one and the effect
// inventory, whose parameter table is the largest the generator produces.
for (const route of [
	BASE,
	`${BASE}soundscaper/recording/`,
	`${BASE}reference/generated/formats/`,
	`${BASE}reference/generated/audio-effects/`,
	`${BASE}guides/`,
	`${BASE}guides/volume/normalize-peaks/`,
	`${BASE}tutorials/clean-up-a-voice-recording/`,
	`${BASE}start/how-soundscaper-compares/`,
]) {
	test(`has no serious accessibility violations at ${route}`, async ({ page }) => {
		await page.goto(route);
		const results = await new AxeBuilder({ page }).analyze();
		const serious = results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
		expect(serious).toEqual([]);
	});
}
