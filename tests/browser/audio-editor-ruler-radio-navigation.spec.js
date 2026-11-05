/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('ruler arrow navigation reaches each visible choice once', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const row = editor.locator('[data-track-row]').filter({ has: page.locator('[data-clip-id]') }).first();
	const ruler = row.locator('[data-track-ruler]');
	await ruler.click({ button: 'right', position: { x: 20, y: 70 } });
	const flyout = page.locator('.audio-editor-ruler-flyout');
	await expect(flyout.getByRole('button', { name: 'Zoom in', exact: true })).toBeFocused();
	await page.keyboard.press('Tab');
	const current = flyout.getByRole('radio', { name: 'Linear (dB)', exact: true });
	const next = flyout.getByRole('radio', { name: 'dB (logarithmic)', exact: true });
	await expect(current).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(next).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await expect(current).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Space');
	await expect(next).toBeChecked();
	await expect(ruler).toHaveAttribute('data-ruler-format', 'logarithmic-db');
	await page.keyboard.press('Tab');
	await expect(flyout.getByRole('checkbox', { name: 'Half wave', exact: true })).toBeFocused();
});
