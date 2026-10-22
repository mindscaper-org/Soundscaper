/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('typing selection endpoints in start-to-end order retains a positive one-sample range', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'sample edit.wav', duration: 1 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	for (const [name, frame] of [['Selection start', 24_001], ['Selection end', 24_002]]) {
		const control = editor.getByRole('group', { name, exact: true });
		await control.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await control.locator('.timecode-digit').first().click();
		await page.keyboard.type(String(frame).padStart(12, '0'));
		await page.keyboard.press('Enter');
		await expect(control.locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
	}
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
	await expect(editor.getByRole('button', { name: 'Loop selection', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
});
