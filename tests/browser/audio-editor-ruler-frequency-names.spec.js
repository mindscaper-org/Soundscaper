/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('spectrogram ruler frequency inputs announce their labels during keyboard editing', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	const track = editor.locator('[data-track-row]').last();
	await expect(track).toHaveAttribute('data-display-mode', 'spectrogram');
	const ruler = track.locator('[data-track-ruler]');
	await ruler.click({ button: 'right', position: { x: 10, y: 40 } });
	const flyout = editor.locator('.ruler-flyout');
	await expect(flyout).toBeVisible();
	await expect(flyout.locator('.ruler-flyout__freq-label')).toHaveText(['Min', 'Max']);
	const minimum = flyout.getByRole('textbox').first();
	const maximum = flyout.getByRole('textbox').last();
	await expect(minimum).toHaveAccessibleName('Min');
	await expect(maximum).toHaveAccessibleName('Max');
	await expect(flyout.getByRole('button', { name: 'Zoom in', exact: true })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(flyout.getByRole('radio', { name: 'Mel', exact: true })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(minimum).toBeFocused();
	await page.keyboard.press('Control+a');
	await page.keyboard.type('500');
	await page.keyboard.press('Enter');
	await expect(ruler).toHaveAttribute('data-ruler-frequency-minimum', '500');
	await maximum.click();
	await page.keyboard.press('Control+a');
	await page.keyboard.type('12000');
	await page.keyboard.press('Enter');
	await expect(ruler).toHaveAttribute('data-ruler-frequency-maximum', '12000');
	await expect(minimum).toHaveValue('500');
	await expect(maximum).toHaveValue('12000');
});
