/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('clip handle visibility', () => {
	registerAudioEditorHooks();
	test('one selected clip keeps all handles; multi-selection across tracks reveals only the hovered clip', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const first = clipByName(editor, toneA.name), second = clipByName(editor, toneB.name);
		await first.locator('.clip-header').click();
		await first.focus(); await first.press('f');
		await first.getByRole('slider', { name: 'Fade in', exact: true }).press('ArrowRight');
		await page.keyboard.press('Escape');
		await page.mouse.move(1, 1);
		const handles = clip => [
			clip.getByRole('button', { name: 'Trim right edge', exact: true }),
			clip.getByRole('button', { name: 'Stretch right edge', exact: true }),
			clip.getByRole('slider', { name: 'Fade in', exact: true }),
			clip.getByRole('slider', { name: 'Looped clip length', exact: true }),
			clip.getByRole('slider', { name: 'Fade in shape', exact: true }),
		];
		for (const handle of handles(first)) await expect(handle).toHaveCSS('opacity', '1');
		await second.locator('.clip-header').click({ modifiers: ['ControlOrMeta'] });
		await first.focus(); await first.press('f');
		await first.getByRole('slider', { name: 'Fade in', exact: true }).press('ArrowRight');
		await page.keyboard.press('Escape');
		await page.mouse.move(1, 1);
		for (const clip of [first, second]) for (const handle of handles(clip)) {
			await expect(handle).toHaveCSS('opacity', '0');
			await expect(handle).toHaveCSS('pointer-events', 'none');
		}
		await first.hover();
		for (const handle of handles(first)) await expect(handle).toHaveCSS('opacity', '1');
		for (const handle of handles(second)) await expect(handle).toHaveCSS('opacity', '0');
		const loop = handles(first)[3];
		const bounds = await loop.boundingBox();
		expect(bounds).not.toBeNull();
		await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(bounds.x + 80, bounds.y + 80, { steps: 5 });
		await expect(loop).toHaveCSS('opacity', '1');
		await page.keyboard.press('Escape'); await page.mouse.up();
		await loop.focus();
		await page.mouse.move(1, 1);
		await expect(loop).toHaveCSS('opacity', '1');
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await first.hover();
		await expect(first.getByRole('slider', { name: 'Fade in', exact: true })).toHaveCSS('opacity', '1');
		await expect(first.getByRole('slider', { name: 'Looped clip length', exact: true })).toHaveCount(0);
		await expect(first.locator('[data-fade-peek]')).toHaveCount(0);
	});

	test('fade menu presets create a fade, show its curve, and undo in one step', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await clip.focus();
		await clip.press('f');
		const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
		await fade.press('Delete');
		await expect(fade).toHaveAttribute('aria-valuenow', '0');
		await fade.press('Shift+F10');
		const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Edit fade-in', exact: true }) });
		await expect(menu.getByRole('menuitemradio', { checked: true })).toHaveCount(0);
		const preset = menu.getByRole('menuitemradio', { name: /Exponential/u });
		await expect(preset.locator('svg path')).toHaveCount(1);
		await preset.click();
		await expect.poll(async () => Number(await fade.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await fade.focus();
		await fade.press('Shift+F10');
		await expect(menu.getByRole('menuitemradio', { name: /Exponential/u })).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(fade).toHaveAttribute('aria-valuenow', '0');
	});
});
