/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

// Node owns each input's Enter/Escape matrix. One native workflow still visits
// all three owners so their enclosing dialog and persistence remain covered.
test('numeric Preferences retain composition and saved values across input owners', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const fields = [
		['Editing', 'Mouse zoom precision', '12', '13'],
		['Audio settings', 'Recording offset (ms)', '120', '130'],
		['Track display', 'Low/mid crossover (Hz)', '300', '310'],
	];
	for (const [tab, label, saved, draft] of fields) {
		await preferences.getByRole('tab', { name: new RegExp(`${tab}$`, 'u') }).click();
		const field = preferences.getByRole('spinbutton', { name: label, exact: true });
		await field.fill(saved);
		await field.press('Enter');
		await expect(field).toHaveValue(saved);
		await field.fill(draft);
		const prevented = await field.evaluate(input => {
			const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true });
			input.dispatchEvent(event);
			return event.defaultPrevented;
		});
		expect(prevented).toBe(false);
		await expect(field).toHaveValue(draft);
		await expect(field).toBeFocused();
		await expect(preferences).toBeVisible();
		await field.press('Enter');
	}
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	for (const [tab, label, , draft] of fields) {
		await preferences.getByRole('tab', { name: new RegExp(`${tab}$`, 'u') }).click();
		await expect(preferences.getByRole('spinbutton', { name: label, exact: true })).toHaveValue(draft);
	}
});
