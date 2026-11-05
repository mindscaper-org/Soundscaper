/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('ruler format text labels activate their existing radio choices', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const row = editor.locator('[data-track-row]').filter({ has: page.locator('[data-clip-id]') }).first();
	const ruler = row.locator('[data-track-ruler]');
	await ruler.click({ button: 'right', position: { x: 20, y: 70 } });
	const flyout = page.locator('.audio-editor-ruler-flyout');
	for (const [label, format] of [['dB (logarithmic)', 'logarithmic-db'], ['Linear (amp)', 'linear-amp']]) {
		const option = flyout.locator('.labeled-radio').filter({ hasText: label });
		await option.locator('.labeled-radio__label').click();
		await expect(option.getByRole('radio')).toBeChecked();
		await expect(option.getByRole('radio')).toBeFocused();
		await expect(ruler).toHaveAttribute('data-ruler-format', format);
	}
});
