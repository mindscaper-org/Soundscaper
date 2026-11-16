/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { TRACK_MENU_TRIGGER } from './helpers/track-menu.js';

for (const [product, route] of [['soundscaper', '/embed/en/'], ['framescaper', '/framescaper/embed/en/']]) {
	test(`${product} menu explanations appear on hover, remain readable, and follow keyboard focus`, async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		const editor = await bootEditor(page, route);
		const file = editor.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true });
		await file.click();
		const menu = editor.locator('.kw-audio-editor__application-menu');
		const create = menu.locator('[data-menu-tooltip-id="new-project"]');
		await create.hover();
		const tooltip = page.locator('.menu-tooltip');
		await expect(tooltip).toHaveText('Start an empty timeline for a separate piece of work.');
		await expect(tooltip).toHaveAttribute('data-side', 'right');
		const itemBounds = await create.boundingBox();
		const tooltipBounds = await tooltip.boundingBox();
		expect(tooltipBounds.x).toBeGreaterThanOrEqual(itemBounds.x + itemBounds.width);
		await expect(create).toHaveAttribute('aria-describedby', await tooltip.getAttribute('id'));
		await tooltip.hover();
		await expect(tooltip).toBeVisible();
		await page.mouse.move(1400, 850);
		await expect(tooltip).toHaveCount(0);
		await expect(create).not.toHaveAttribute('aria-describedby');
		await create.focus();
		await create.press('ArrowDown');
		await expect(tooltip).toContainText('Choose an existing session');
		await page.keyboard.press('Escape');
		await expect(tooltip).toHaveCount(0);
		await expect(menu).toHaveCount(0);
		await expect(file).toBeFocused();
	});
}

test('disabled submenu commands explain their purpose with rich content without covering their parent menu', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('menubar').getByRole('menuitem', { name: 'Effect', exact: true }).click();
	const category = editor.locator('[data-menu-tooltip-id="volumeCompression"]');
	await category.hover();
	const limiter = editor.locator('[data-menu-tooltip-id="audacity-limiter"]');
	await expect(limiter).toHaveAttribute('aria-disabled', 'true');
	await limiter.hover();
	const tooltip = page.locator('.menu-tooltip');
	await expect(tooltip).toContainText('configured threshold to prevent clipping');
	await expect(tooltip.locator('svg')).toBeVisible();
	const itemBounds = await limiter.boundingBox();
	const tooltipBounds = await tooltip.boundingBox();
	expect(tooltipBounds.x).toBeGreaterThanOrEqual(itemBounds.x + itemBounds.width);
	await page.keyboard.press('Escape');
	await expect(tooltip).toHaveCount(0);
});

test('a menu near the right viewport edge places its explanation on the left', async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 800 });
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('menubar').getByRole('menuitem', { name: 'Help', exact: true }).click();
	const manual = editor.locator('[data-menu-tooltip-id="manual"]');
	await manual.hover();
	const tooltip = page.locator('.menu-tooltip');
	await expect(tooltip).toContainText('handbook');
	await expect(tooltip).toHaveAttribute('data-side', 'left');
	const itemBounds = await manual.boundingBox();
	const bounds = await tooltip.boundingBox();
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(itemBounds.x);
	expect(bounds.x).toBeGreaterThanOrEqual(8);
	expect(bounds.y + bounds.height).toBeLessThanOrEqual(792);
});

test('track context menu explanations use the same hover lifecycle', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-track-row]').first().getByRole('button', { name: TRACK_MENU_TRIGGER }).first().click();
	const menu = page.locator('.audio-editor-track-menu');
	const lock = menu.locator('[data-menu-tooltip-id="track-lock-toggle"]');
	await lock.hover();
	const tooltip = page.locator('.menu-tooltip');
	await expect(tooltip).toHaveText('Protect this lane against accidental content and structural changes.');
	await lock.click();
	await expect(menu).toHaveCount(0);
	await expect(tooltip).toHaveCount(0);
});
