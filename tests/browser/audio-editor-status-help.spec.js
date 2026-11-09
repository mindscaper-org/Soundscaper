/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('contextual status help opts in through View and follows the current shortcut assignment', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const hint = 'Drag clips to move them. Drag their edges to trim. Drag in the ruler to create a time selection.';
	await expect(editor.getByText(hint, { exact: true })).toBeVisible();
	await importFiles(editor, [createWavFixture({ name: 'Status.wav', frequency: 440, duration: 2 })]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('Undo');
	const command = preferences.getByRole('group', { name: 'Undo', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+Shift+Y');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'View', 'Contextual status help');
	await editor.getByRole('button', { name: 'Undo', exact: true }).hover();
	await expect(editor.getByText('Undo (Ctrl+Alt+Shift+Y)', { exact: true })).toBeVisible();
	await editor.getByRole('button', { name: 'Undo', exact: true }).focus();
	await expect(editor.getByText('Undo (Ctrl+Alt+Shift+Y)', { exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'View', 'Contextual status help');
	await editor.getByRole('button', { name: 'Undo', exact: true }).hover();
	await expect(editor.getByText(hint, { exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});

test('the status cue keeps the chosen playback speed visible while the speed control is closed', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Speed.wav', frequency: 440, duration: 8 })]);
	await chooseCommandAction(page, editor, 'View', 'Contextual status help');
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	await editor.getByRole('slider', { name: 'Playback speed', exact: true }).fill('1.25');
	await expect(editor.getByText('Stopped · 125%', { exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(editor.getByRole('slider', { name: 'Playback speed', exact: true })).toHaveCount(0);
	await expect(editor.getByText('Stopped · 125%', { exact: true })).toBeVisible();
	await editor.getByRole('button', { name: 'Play at speed', exact: true }).click();
	await expect(editor.getByText('Playing · 125%', { exact: true })).toBeVisible({ timeout: 20_000 });
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor.getByText('Stopped · 125%', { exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});
