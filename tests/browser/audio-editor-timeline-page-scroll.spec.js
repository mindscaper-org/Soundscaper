/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('PageUp and PageDown scroll the timeline horizontally and remain available in View', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [longTone]);
	for (let step = 0; step < 3; step++) await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
	const timeline = editor.locator('[data-timeline]');
	await expect.poll(() => timeline.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(2000);
	await timeline.evaluate(element => { element.scrollLeft = 0; element.dispatchEvent(new Event('scroll')); });
	const panel = editor.locator('.audio-editor-timeline-panel');
	await panel.evaluate(element => { element.tabIndex = -1; element.focus(); });
	const viewportWidth = await editor.locator('[data-ruler]').evaluate(element => element.getBoundingClientRect().width);
	const expectScroll = async offset => {
		await expect.poll(async () => Math.abs(await timeline.evaluate(element => element.scrollLeft) - offset)).toBeLessThanOrEqual(2);
	};
	await page.keyboard.press('PageDown');
	await expectScroll(viewportWidth);
	await page.keyboard.press('PageDown');
	await expectScroll(viewportWidth * 2);
	await page.keyboard.press('PageUp');
	await expectScroll(viewportWidth);
	await page.keyboard.press('PageUp');
	await page.keyboard.press('PageUp');
	await expect.poll(() => timeline.evaluate(element => element.scrollLeft)).toBe(0);
	await chooseCommandAction(page, editor, 'View', 'Scroll timeline right one page');
	await expectScroll(viewportWidth);
	await chooseCommandAction(page, editor, 'View', 'Scroll timeline left one page');
	await expect.poll(() => timeline.evaluate(element => element.scrollLeft)).toBe(0);

	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const title = page.getByRole('dialog', { name: 'Rename project', exact: true }).getByRole('textbox').first();
	await title.press('PageDown');
	await expect.poll(() => timeline.evaluate(element => element.scrollLeft)).toBe(0);
});
