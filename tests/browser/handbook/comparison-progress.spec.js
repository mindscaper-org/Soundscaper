import { expect } from '@playwright/test';
import { test } from '../audio-editor-test-fixtures.js';
import { handbookPlan } from '../../../scripts/lib/product-web-routing.mjs';

const BASE = handbookPlan('soundscaper').scope;
const ROUTE = `${BASE}start/how-soundscaper-compares/`;

test('comparison totals are available without JavaScript and match the rendered verdict cells', async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(ROUTE);
		await expect(page.getByRole('heading', { name: 'Verdict totals', exact: true })).toBeVisible();
		const expected = await page.locator('main table.verdict-table').evaluateAll(tables => {
			const products = [...tables[0].tHead.rows].at(-1).cells;
			return [...products].map((header, index) => {
				const counts = { yes: 0, partial: 0, no: 0, unknown: 0 };
				for (const table of tables) for (const body of table.tBodies) for (const row of body.rows) {
					for (const state of Object.keys(counts)) if (row.cells[index + 1].classList.contains(`verdict-cell--${state}`)) counts[state]++;
				}
				return { ...counts, name: header.innerText.replace(/\s+/gu, ' ').trim() };
			});
		});
		expected.sort((left, right) => right.yes - left.yes || right.partial - left.partial);
		const charts = page.locator('.comparison-summary figure');
		await expect(charts).toHaveCount(expected.length);
		for (const [index, counts] of expected.entries()) {
			await expect(charts.nth(index)).toHaveAccessibleName(counts.name);
			await expect(charts.nth(index).getByRole('img')).toHaveAccessibleName(new RegExp(`${counts.yes} supported, ${counts.partial} limited, ${counts.no} unavailable`, 'u'));
			await expect(charts.nth(index).locator('dd')).toHaveText([counts.yes, counts.partial, counts.no].map(String));
		}
		await expect(page.locator('.comparison-summary .comparison-bar')).toHaveCount(expected.length);
	} finally {
		await context.close();
	}
});

test('comparison headers stay aligned while row counts advance, rewind, and cross sections', async ({ page }) => {
	await page.goto(ROUTE);
	const first = page.getByRole('region', { name: 'Platform and terms', exact: true });
	await expect(first.locator('.comparison-counter').first()).toBeVisible();
	const pinned = page.locator('.comparison-sticky-header');
	await expect(pinned).toBeHidden();
	const globalTable = await pinned.locator('table').elementHandle();

	for (const name of ['Platform and terms', 'MIDI & Notes', 'Machine assistance']) {
		const region = page.getByRole('region', { name, exact: true });
		await region.locator('tbody tr').nth(3).evaluate(row => {
			const header = document.querySelector('.page > header').getBoundingClientRect();
			const toc = document.querySelector('mobile-starlight-toc summary')?.getBoundingClientRect();
			const top = Math.max(header.bottom, toc?.height ? toc.bottom : 0);
			const height = document.querySelector('main table.verdict-table').tHead.getBoundingClientRect().height;
			window.scrollTo({ top: window.scrollY + row.getBoundingClientRect().bottom - top - height + 2, behavior: 'instant' });
		});
		await expect(pinned).toBeVisible();
		expect(await globalTable.evaluate(table => table === document.querySelector('.comparison-sticky-header table'))).toBe(true);
		await expect.poll(async () => {
			const expected = await page.locator('main tr[data-comparison-verdicts]').evaluateAll(rows => {
				const line = document.querySelector('.comparison-sticky-header').getBoundingClientRect().bottom;
				const counts = { yes: 0, partial: 0, no: 0 };
				for (const row of rows) {
					if (row.getBoundingClientRect().bottom > line) continue;
					for (const state of Object.keys(counts)) if (row.cells[1].classList.contains(`verdict-cell--${state}`)) counts[state]++;
				}
				return Object.values(counts).map(String);
			});
			return await pinned.locator('[data-comparison-counter="0"] [data-count]:not([data-count="unknown"])').allTextContents().then(actual => JSON.stringify(actual) === JSON.stringify(expected));
		}).toBe(true);

		await region.evaluate(element => { element.scrollLeft = element.scrollWidth; });
		await expect.poll(() => pinned.locator('.comparison-table-scroll').evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
		const originalX = await region.locator('tbody tr').first().locator('td').last().evaluate(element => element.getBoundingClientRect().x);
		const pinnedX = await pinned.locator('thead tr').last().locator('th').last().evaluate(element => element.getBoundingClientRect().x);
		expect(pinnedX).toBeCloseTo(originalX, 0);
		const pageWidth = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
		expect(pageWidth[0]).toBeLessThanOrEqual(pageWidth[1]);
	}
	const laterHeads = page.locator('main table.verdict-table').locator('thead').filter({ hasNot: page.locator('[data-comparison-counter]') });
	for (const head of await laterHeads.all()) {
		const box = await head.boundingBox();
		expect(box.height).toBeLessThanOrEqual(1);
	}
	await page.getByRole('heading', { name: 'Timeline editing', exact: true }).evaluate(heading => {
		const header = document.querySelector('.page > header').getBoundingClientRect();
		const toc = document.querySelector('mobile-starlight-toc summary')?.getBoundingClientRect();
		window.scrollTo({ top: window.scrollY + heading.getBoundingClientRect().top - Math.max(header.bottom, toc?.height ? toc.bottom : 0), behavior: 'instant' });
	});
	await expect(pinned).toBeVisible();
	const tocToggle = page.locator('mobile-starlight-toc summary');
	if (await tocToggle.isVisible()) await tocToggle.click();
	await page.getByRole('link', { name: 'MIDI & Notes', exact: true }).click();
	await expect.poll(async () => {
		const heading = await page.getByRole('heading', { name: 'MIDI & Notes', exact: true }).boundingBox();
		const header = await pinned.boundingBox();
		return heading.y - header.y - header.height;
	}).toBeGreaterThanOrEqual(0);
	await page.getByRole('heading', { name: 'Verdict totals', exact: true }).scrollIntoViewIfNeeded();
	await expect(pinned).toBeVisible();
	const bars = page.locator('.comparison-summary figure');
	const boxes = await bars.evaluateAll(figures => figures.map(figure => {
		const { x, y, width, height } = figure.getBoundingClientRect();
		return { x, y, width, height };
	}));
	for (const [index, box] of boxes.entries()) {
		expect(box.width).toBeLessThanOrEqual(720);
		expect(box.width).toBeCloseTo(boxes[0].width, 0);
		if (index) expect(box.y).toBeGreaterThanOrEqual(boxes[index - 1].y + boxes[index - 1].height);
	}

	await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
	await expect(pinned).toBeHidden();
	await expect(first.locator('[data-comparison-counter="0"] [data-count="yes"]')).toHaveText('0');
	await page.goto(`${BASE}soundscaper/recording/`);
	await expect(page.locator('.comparison-sticky-header, .comparison-summary')).toHaveCount(0);
});
