/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, showToolbarButton } from './audio-editor-test-helpers.js';

test('Snap checkbox releases an assigned modified Enter command', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+Enter');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
	await page.keyboard.press('Control+Alt+Enter');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await showToolbarButton(page, editor, 'Snap');
	const snap = editor.getByRole('checkbox', { name: 'Snap', exact: true });
	await expect(snap).toBeVisible();
	const original = await snap.getAttribute('aria-checked');
	await snap.focus();
	await snap.press('Control+Alt+Enter');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(snap).toHaveAttribute('aria-checked', original);
	await snap.press('Space');
	await expect(snap).toHaveAttribute('aria-checked', original === 'true' ? 'false' : 'true');
	await snap.press('Enter');
	await expect(snap).toHaveAttribute('aria-checked', original);
});

test('Chirp interpolation radio preserves unclaimed modified activation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Chirp');
	const dialog = page.getByRole('dialog', { name: 'Chirp', exact: true });
	const linear = dialog.getByRole('radio', { name: 'Linear', exact: true });
	await expect(linear).toHaveAttribute('aria-checked', 'false');
	await linear.focus();
	await linear.press('Control+Alt+Enter');
	await expect(dialog).toBeVisible();
	await expect(linear).toHaveAttribute('aria-checked', 'false');
	await linear.press('Space');
	await expect(linear).toHaveAttribute('aria-checked', 'true');
	const logarithmic = dialog.getByRole('radio', { name: 'Logarithmic', exact: true });
	await logarithmic.focus();
	await logarithmic.press('Enter');
	await expect(logarithmic).toHaveAttribute('aria-checked', 'true');
});
