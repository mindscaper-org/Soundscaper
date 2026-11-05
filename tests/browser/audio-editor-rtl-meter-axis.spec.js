/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, getMenuItem } from './audio-editor-test-helpers.js';
import { localeCopy } from './helpers/locale-copy.js';

for (const locale of ['en', 'ar']) test(`${locale} horizontal meter volume follows its displayed dB ruler`, async ({ page }) => {
	const copy = localeCopy(locale);
	const editor = await bootEditor(page, `/embed/${locale}/`);
	const toggleMeter = async () => {
		await editor.getByRole('menubar').getByRole('menuitem', { name: copy.windowMenu, exact: true }).click();
		await getMenuItem(page.getByRole('menu', { name: copy.windowMenu, exact: true }), copy.panelPlaybackMeter).click();
	};
	await toggleMeter();
	const panel = editor.locator('[data-workspace-panel="playback-meter"]');
	if (!await panel.count()) await toggleMeter();
	await panel.locator('.kw-audio-editor__audacity-level-button').click();
	await page.getByRole('radio', { name: copy.meterPositionTop, exact: true }).click();
	await page.keyboard.press('Escape');
	const meter = editor.locator('[data-audio-meter][data-meter-kind="playback"][data-meter-position="top"]');
	await expect(meter).toBeVisible();
	await expect(meter).toHaveCSS('direction', locale === 'ar' ? 'rtl' : 'ltr');
	const slider = meter.getByRole('slider');
	await expect(slider).toHaveValue('1');
	const rect = await slider.boundingBox();
	expect(rect).toBeTruthy();
	await page.mouse.click(rect.x + rect.width - 12, rect.y + rect.height / 2);
	await expect(slider).toHaveValue('1');
	await expect(slider).toHaveCSS('direction', 'ltr');
	await page.mouse.move(rect.x + rect.width - 12, rect.y + rect.height / 2);
	await page.mouse.down();
	await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(.7);
});
