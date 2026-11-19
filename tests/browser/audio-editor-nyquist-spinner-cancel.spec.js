/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Nyquist Escape keeps a held native spinner canceled through release and later keyboard entry works', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Nyquist', 'Adjustable Fade']);
	const dialog = page.getByRole('dialog', { name: 'Adjustable Fade', exact: true });
	const input = dialog.getByRole('spinbutton', { name: 'Mid-fade Adjust (%)', exact: true });
	await expect(input).toHaveValue('0');
	await input.scrollIntoViewIfNeeded();
	const box = await input.boundingBox();
	expect(box).not.toBeNull();
	const padding = await input.evaluate(field => Number.parseFloat(getComputedStyle(field).paddingRight));
	await page.mouse.move(box.x + box.width - padding - 7, box.y + box.height / 2 - 4);
	await page.mouse.down();
	try {
		await expect.poll(async () => Number(await input.inputValue())).toBeGreaterThan(1);
		await expect(input).toBeFocused();
		await input.evaluate(field => {
			globalThis.__nyquistSpinnerPostCancel = 0;
			field.addEventListener('input', () => { globalThis.__nyquistSpinnerPostCancel += 1; });
		});
		await page.keyboard.press('Escape');
		await expect(input).toHaveValue('0');
		await expect.poll(() => page.evaluate(() => globalThis.__nyquistSpinnerPostCancel)).toBeGreaterThanOrEqual(3);
	} finally { await page.mouse.up(); }
	await input.press('Tab');
	await expect(dialog).toBeVisible();
	await expect(input).toHaveValue('0');
	await input.focus(); await input.press('ArrowUp'); await input.press('Enter');
	await expect(input).toHaveValue('1');
	await input.press('Escape');
	await expect(dialog).toBeHidden();
});
