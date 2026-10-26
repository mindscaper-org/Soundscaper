/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, showToolbarButton } from './audio-editor-test-helpers.js';

for (const escapeMagnet of [false, true]) test(`the selection drag preview shows its committed grid bounds${escapeMagnet ? ' after Escape releases a magnet' : ''}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await showToolbarButton(page, editor, 'Snap');
	await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
	await expect(editor.getByRole('checkbox', { name: 'Snap', exact: true })).toHaveAttribute('aria-checked', 'true');
	const clip = await clipByName(editor, toneA.name).locator('.clip-display').boundingBox();
	const ruler = await editor.locator('[data-ruler]').boundingBox();
	expect(clip).not.toBeNull(); expect(ruler).not.toBeNull();
	await page.mouse.move(clip.x + clip.width / 4, ruler.y + 26);
	await page.mouse.down();
	await page.mouse.move(clip.x + clip.width * (escapeMagnet ? 0.99 : 3 / 4), ruler.y + 26, { steps: 4 });
	if (escapeMagnet) await page.keyboard.press('Escape');
	const overlay = editor.locator('[data-time-selection-overlay]').first();
	await expect(overlay).toBeVisible();
	const preview = await overlay.boundingBox();
	await page.mouse.up();
	await expect(editor.getByRole('group', { name: 'Selection start', exact: true }).locator('.timecode__display')).toHaveText('00h00m00.000s');
	await expect(editor.getByRole('group', { name: 'Selection end', exact: true }).locator('.timecode__display')).toHaveText('00h00m01.000s');
	const committed = await overlay.boundingBox();
	expect(preview).not.toBeNull(); expect(committed).not.toBeNull();
	expect(preview.x).toBeCloseTo(committed.x, 0);
	expect(preview.width).toBeCloseTo(committed.width, 0);
});
