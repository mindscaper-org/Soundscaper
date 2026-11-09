/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('resizing a ruler flyout keeps its focused frequency control reachable and editable', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	const ruler = editor.locator('[data-track-ruler]').last();
	await ruler.click({ button: 'right', position: { x: 10, y: 140 } });
	const flyout = editor.locator('.ruler-flyout');
	const maximum = flyout.getByRole('textbox', { name: 'Max', exact: true });
	await expect(maximum).toBeInViewport({ ratio: 1 });
	await maximum.click();
	await expect(maximum).toBeFocused();
	await maximum.fill('12000');
	await expect(maximum).toHaveValue('12000');
	await maximum.press('Enter');
	await expect(ruler).toHaveAttribute('data-ruler-frequency-maximum', '12000');
	await expect(flyout).toHaveCSS('transform', 'none');
	const original = await flyout.boundingBox();
	expect(original).not.toBeNull();
	await maximum.press('ControlOrMeta+a');
	await expect.poll(() => maximum.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([0, 5]);
	await page.setViewportSize({ width: 1280, height: 700 });
	await expect(maximum).toBeInViewport({ ratio: 1 });
	await expect(maximum).toBeFocused();
	expect(await maximum.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([0, 5]);
	await page.keyboard.type('14000');
	await page.keyboard.press('Enter');
	await expect(ruler).toHaveAttribute('data-ruler-frequency-maximum', '14000');
	await expect(maximum).toHaveValue('14000');
	await page.setViewportSize({ width: 1280, height: 900 });
	await expect.poll(async () => Math.round((await flyout.boundingBox()).y)).toBe(Math.round(original.y));
	await page.keyboard.press('Escape');
	await expect(flyout).toBeHidden();
});
