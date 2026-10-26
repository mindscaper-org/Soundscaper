/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, collectClientErrors, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('upstream fade corner zones', () => {
	registerAudioEditorHooks();

	test('selected handles persist away from the pointer; unselected corners edit without selecting and Undo restores', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		const fadeIn = clip.locator('button[data-clip-fade-handle="in"]');
		await page.mouse.move(1, 1);
		await expect(fadeIn).toHaveCSS('opacity', '1');
		await expect(fadeIn.locator('[data-fade-glyph-frame]')).toHaveAttribute('fill', '#000000');
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await expect(fadeIn).toHaveCSS('opacity', '0');
		const initial = await fadeIn.getAttribute('aria-valuenow');
		const zone = clip.locator('[data-fade-zone="in"]');
		await expect(zone).toBeVisible();
		const bounds = await zone.boundingBox();
		expect(bounds).not.toBeNull();
		const x = bounds.x + 27;
		const y = bounds.y + 16;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 40, y, { steps: 5 });
		await expect(page.locator('[data-fade-length-drag]')).toHaveCount(1);
		await page.mouse.up();
		await expect(page.locator('[data-fade-length-drag]')).toHaveCount(0);
		await expect.poll(async () => Number(await fadeIn.getAttribute('aria-valuenow'))).toBeGreaterThan(Number(initial));
		await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'false');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(fadeIn).toHaveAttribute('aria-valuenow', initial);
		expect(errors).toEqual([]);
	});

	test('a bare unselected corner previews its S-curve and removes the preview during the native fade drag', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Editing$/u }).click();
		await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips' }).uncheck();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		const zone = clip.locator('[data-fade-zone="in"]');
		await zone.hover({ position: { x: 27, y: 16 } });
		await expect(clip.locator('[data-fade-peek="in"]')).toBeVisible();
		await page.mouse.down();
		await expect(clip.locator('[data-fade-peek="in"]')).toHaveCount(0);
		await page.mouse.move(1, 1);
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await expect(page.locator('[data-fade-length-drag]')).toHaveCount(0);
		await expect(clip.locator('button[data-clip-fade-handle="in"]')).toHaveAttribute('aria-valuenow', '0');
	});
});
