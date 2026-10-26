/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, importFiles, setDocumentTheme, waitForEditor } from './audio-editor-test-helpers.js';

for (const theme of ['light', 'dark']) test(`optional track height toolbar steps every row and persists in ${theme}`, async ({ page }) => {
	const errors = collectClientErrors(page);
	let editor = await bootEditor(page, '/embed/en/');
	await setDocumentTheme(page, theme);
	await importFiles(editor, [toneA, toneB]);
	const labels = ['Decrease all track heights', 'Increase all track heights', 'Fit tracks to height'];
	for (const name of labels) await expect(editor.getByRole('button', { name, exact: true })).toHaveCount(0);
	await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
	const customize = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
	for (const name of labels) {
		const option = customize.getByRole('checkbox', { name, exact: true });
		await expect(option).toHaveAttribute('aria-checked', 'false');
		await option.click();
		await expect(option).toHaveAttribute('aria-checked', 'true');
	}
	await page.keyboard.press('Escape');
	const rows = editor.locator('[data-track-row]');
	const heights = () => rows.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
	const initial = await heights();
	await editor.getByRole('button', { name: labels[0], exact: true }).click();
	await expect.poll(heights).toEqual(initial.map(height => Math.max(40, height - 16)));
	await editor.getByRole('button', { name: labels[1], exact: true }).click();
	await expect.poll(heights).toEqual(initial);
	await editor.getByRole('button', { name: labels[2], exact: true }).click();
	const available = Number(await editor.locator('[data-track-height-available]').getAttribute('data-track-height-available'));
	await expect.poll(async () => (await heights()).reduce((sum, height) => sum + height, 0)).toBeLessThanOrEqual(available + 2);
	await page.reload();
	editor = await waitForEditor(page);
	for (const name of labels) await expect(editor.getByRole('button', { name, exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});

test('track visual group keeps per-track height stepping and fitting on the clicked row', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const rows = editor.locator('[data-track-row]');
	const first = rows.nth(0);
	const second = rows.nth(1);
	const initial = (await second.boundingBox()).height;
	const firstHeight = (await first.boundingBox()).height;
	await second.getByRole('button', { name: 'Track menu', exact: true }).click();
	const menu = page.locator('.audio-editor-track-menu[role="menu"]');
	const height = menu.getByRole('menuitem', { name: /^Track height/u });
	await height.hover();
	await height.getByRole('menu').getByRole('menuitem', { name: 'Increase track height', exact: true }).click();
	await expect.poll(async () => (await second.boundingBox()).height).toBe(initial + 16);
	await expect.poll(async () => (await first.boundingBox()).height).toBe(firstHeight);
	await second.getByRole('button', { name: 'Track menu', exact: true }).click();
	await height.hover();
	await height.getByRole('menu').getByRole('menuitem', { name: 'Fit to height', exact: true }).click();
	const available = Number(await editor.locator('[data-track-height-available]').getAttribute('data-track-height-available'));
	await expect.poll(async () => (await second.boundingBox()).height).toBe(Math.max(40, Math.floor(available - firstHeight)));
	await expect.poll(async () => (await first.boundingBox()).height).toBe(firstHeight);
});
