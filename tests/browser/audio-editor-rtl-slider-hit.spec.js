/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';
import { localeCopy } from './helpers/locale-copy.js';

for (const locale of ['en', 'ar']) test(`${locale} track-volume painted thumb is the native pointer hit target`, async ({ page }) => {
	const editor = await bootEditor(page, `/embed/${locale}/`);
	await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
	await importFiles(editor, [monoTone], { copy: localeCopy(locale) });
	const row = editor.locator('[data-track-row]').filter({ has: page.locator('[data-clip-id]') }).first();
	const slider = row.locator('.audio-editor-track-controls .slider');
	const input = slider.locator('input[type="range"]');
	const initial = await input.inputValue();
	const thumb = await slider.locator('.slider__handle').boundingBox();
	expect(thumb).toBeTruthy();
	await page.mouse.click(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
	await expect(input).toHaveValue(initial);
	await expect(row.locator('.audio-editor-track-controls')).toHaveCSS('direction', locale === 'ar' ? 'rtl' : 'ltr');
	const x = thumb.x + thumb.width / 2;
	const y = thumb.y + thumb.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 8, y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => Number(await input.inputValue())).toBeGreaterThan(Number(initial));
});
