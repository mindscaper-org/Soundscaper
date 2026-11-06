/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('video exact-number Escape retires native spinner repeats through release', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('number-spinner.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const properties = await openClipProperties(page, editor, clip);
	const rack = properties.locator('[data-video-effect-rack]');
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	const input = rack.locator('[data-video-effect-type="color-adjust"] [data-video-effect-param="brightness"] input[type="number"]');
	await expect(input).toHaveValue('0');
	await input.scrollIntoViewIfNeeded();
	// Expose WebKit's native spinner before measuring and holding its increment arrow.
	await input.focus();
	await expect(input).toBeFocused();
	await input.hover();
	const box = await input.boundingBox();
	expect(box).not.toBeNull();
	const padding = await input.evaluate(field => Number.parseFloat(getComputedStyle(field).paddingRight));
	await page.mouse.move(box.x + box.width - padding - 7, box.y + box.height / 2 - 4);
	await page.mouse.down();
	try {
		await expect.poll(async () => Number(await input.inputValue())).toBeGreaterThan(.01);
		await expect(input).toBeFocused();
		await input.evaluate(field => {
			globalThis.__videoNumberRepeats = 0;
			field.addEventListener('input', () => { globalThis.__videoNumberRepeats += 1; });
		});
		await page.keyboard.press('Escape');
		await expect.poll(() => page.evaluate(() => globalThis.__videoNumberRepeats)).toBeGreaterThanOrEqual(3);
	} finally { await page.mouse.up(); }
	await input.press('Tab');
	await expect(properties).toBeVisible();
	await expect(input).toHaveValue('0');
	await input.focus();
	await input.press('ArrowUp');
	await input.press('Enter');
	await expect(input).toHaveValue('0.01');
});
