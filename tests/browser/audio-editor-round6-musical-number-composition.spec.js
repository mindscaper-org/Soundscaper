/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

for (const [label, saved, draft] of [
	['Project tempo (BPM)', '130', '140'],
	['Time signature: numerator', '3', '5'],
	['Time signature: denominator', '8', '16'],
]) {
	test(`musical numeric authoring preserves native ${label} composition`, async ({ page }) => {
		const editor = await bootEditor(page, '/en/');
		await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
		const choice = label === 'Time signature: denominator';
		const field = editor.getByRole(choice ? 'combobox' : 'spinbutton', { name: label, exact: true });
		if (choice) await field.selectOption(saved);
		else await field.fill(saved);
		await field.focus();
		await field.press('Enter');
		await expect(field).toHaveValue(saved);
		if (choice) await field.selectOption(draft);
		else await field.fill(draft);
		await field.focus();
		for (const key of ['Escape', 'Enter']) {
			const prevented = await field.evaluate((input, key) => {
				const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true });
				input.dispatchEvent(event);
				return event.defaultPrevented;
			}, key);
			expect(prevented).toBe(false);
			await expect(field).toHaveValue(draft);
			await expect(field).toBeFocused();
		}
		await field.press('Enter');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(field).toHaveValue(saved);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect(field).toHaveValue(draft);
		await expect(editor.getByRole('alert')).toHaveCount(0);
	});
}
