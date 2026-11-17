/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, collectClientErrors, importFiles,
	openNestedCommandMenu, getMenuItem, openEffectsForTrack, addRackEffect, closeEffectsPanel,
	waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';

async function openPlaylists(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Track playlists']);
	const dialog = page.getByRole('dialog', { name: 'Track playlists', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

test('track playlists preserve edits, undo switches, rename and persist across reloads', async ({ page }) => {
	const errors = collectClientErrors(page);
	let editor = await bootEditor(page, '/embed/en/');
	await expect(page.getByRole('dialog', { name: 'Track playlists', exact: true })).toHaveCount(0);
	await importFiles(editor, [toneA]);
	const effects = await openEffectsForTrack(editor, await editor.locator('[data-track-row]').count() - 1);
	await addRackEffect(page, effects, 'track', 'Feedback delay');
	await page.getByRole('dialog', { name: 'Feedback delay', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
	await closeEffectsPanel(effects);
	await clipByName(editor, toneA.name).getByText(toneA.name, { exact: true }).click();
	let dialog = await openPlaylists(page, editor);
	await dialog.getByRole('textbox', { name: 'Playlist name', exact: true }).fill('Dialogue edit');
	await dialog.getByRole('button', { name: 'Duplicate current playlist', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Dialogue edit (active)', exact: true })).toHaveCount(1);
	await expect(dialog.getByRole('button', { name: 'Delete playlist', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click();
	await clipByName(editor, toneA.name).getByText(toneA.name, { exact: true }).click();
	await page.keyboard.press('Delete');
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
	dialog = await openPlaylists(page, editor);
	await dialog.getByRole('listbox', { name: 'Playlists', exact: true }).selectOption({ label: 'Original' });
	await dialog.getByRole('button', { name: 'Activate playlist', exact: true }).click();
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Freeze track']);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const tracks = await openNestedCommandMenu(page, editor, 'Tracks', []);
	await expect(getMenuItem(tracks, 'Freeze (fresh)')).toBeVisible();
	await page.keyboard.press('Escape');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Unfreeze track']);
	dialog = await openPlaylists(page, editor);
	await dialog.getByRole('listbox', { name: 'Playlists', exact: true }).selectOption({ label: 'Dialogue edit' });
	await dialog.getByRole('button', { name: 'Activate playlist', exact: true }).click();
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
	await dialog.getByRole('listbox', { name: 'Playlists', exact: true }).selectOption({ label: 'Original' });
	await dialog.getByRole('button', { name: 'Activate playlist', exact: true }).click();
	await dialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click();
	await page.keyboard.press('ControlOrMeta+z');
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	dialog = await openPlaylists(page, editor);
	await dialog.getByRole('listbox', { name: 'Playlists', exact: true }).selectOption({ label: 'Dialogue edit' });
	await dialog.getByRole('textbox', { name: 'Playlist name', exact: true }).fill('Short cut');
	await dialog.getByRole('button', { name: 'Rename playlist', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Short cut', exact: true })).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	editor = await waitForEditor(page);
	await waitForProjectActivation(editor);
	await clipByName(editor, toneA.name).getByText(toneA.name, { exact: true }).click();
	dialog = await openPlaylists(page, editor);
	await dialog.getByRole('listbox', { name: 'Playlists', exact: true }).selectOption({ label: 'Short cut' });
	await dialog.getByRole('button', { name: 'Activate playlist', exact: true }).click();
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
	await dialog.getByRole('listbox', { name: 'Playlists', exact: true }).selectOption({ label: 'Original' });
	await dialog.getByRole('button', { name: 'Activate playlist', exact: true }).click();
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	await dialog.getByRole('listbox', { name: 'Playlists', exact: true }).selectOption({ label: 'Short cut' });
	await dialog.getByRole('button', { name: 'Delete playlist', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Short cut', exact: true })).toHaveCount(0);
	await dialog.getByRole('textbox', { name: 'Playlist name', exact: true }).fill('New recording');
	await dialog.getByRole('button', { name: 'Create empty playlist', exact: true }).click();
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
	await dialog.getByRole('listbox', { name: 'Playlists', exact: true }).selectOption({ label: 'Original' });
	await dialog.getByRole('button', { name: 'Activate playlist', exact: true }).click();
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click();
	expect(errors).toEqual([]);
});
