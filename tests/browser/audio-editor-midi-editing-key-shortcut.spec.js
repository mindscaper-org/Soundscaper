/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('piano editing releases an assigned Alt Delete command while retaining ordinary note Delete', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'chord.mid', mimeType: 'audio/midi',
		buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Alt+Delete');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
	await page.keyboard.press('Alt+Delete');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	const clipHeader = editor.locator('[data-clip-id] .clip-header').last();
	await clipHeader.click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const selected = panel.getByRole('combobox', { name: 'Selected note', exact: true });
	await expect(selected.getByRole('option')).toHaveCount(2);
	await selected.selectOption({ index: 1 });
	const grid = panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]');
	await grid.focus(); await page.keyboard.press('Alt+Delete');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	// The assigned command selects its new track. Return to the original authoring target.
	await clipHeader.click();
	await expect(selected.getByRole('option')).toHaveCount(2);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await clipHeader.click(); await selected.selectOption({ index: 1 });
	await grid.focus(); await page.keyboard.press('Delete');
	await expect(selected.getByRole('option')).toHaveCount(1);
});
