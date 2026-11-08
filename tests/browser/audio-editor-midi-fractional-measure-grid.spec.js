/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('every three-eighths piano-roll bar matches the ruler measure line', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await expect(editor).toHaveAttribute('data-workspace-preset', 'music');
	await editor.getByRole('spinbutton', { name: 'Time signature: numerator', exact: true }).fill('3');
	const denominator = editor.getByRole('combobox', { name: 'Time signature: denominator', exact: true });
	await denominator.focus();
	await denominator.selectOption('8');
	await denominator.blur();
	await expect(denominator).toHaveValue('8');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('modern');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const canvas = panel.locator('.kw-audio-editor__piano-roll-notes > div[tabindex="0"] > canvas');
	await expect(canvas).toBeVisible();
	await expect.poll(() => canvas.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(180);
	const columns = await canvas.evaluate(element => {
		const context = element.getContext('2d');
		const ratio = element.width / element.getBoundingClientRect().width;
		return [.75, 1.5].map(time => Array.from(context.getImageData(Math.round(time * 100 * ratio), Math.round(9 * ratio), 1, 1).data));
	});
	expect(columns[0][3]).toBe(255);
	expect(columns[1][3]).toBe(255);
	expect(columns[0], 'bar2 at0.75s has the same measure line as bar3 at1.5s').toEqual(columns[1]);
});
