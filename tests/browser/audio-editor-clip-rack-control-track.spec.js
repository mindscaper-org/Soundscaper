/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, closeDialog, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Duplicate selection retains the clip effect rack', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	let panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await panel.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, panel, 'track', 'Echo');
	await closeDialog(page.getByRole('dialog', { name: 'Echo', exact: true }));
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
	await expect(clipByName(editor, toneA.name)).toHaveCount(2);
	panel = await openClipProperties(page, editor, clipByName(editor, toneA.name).last());
	const effects = panel.getByText('Effects', { exact: true });
	if (await panel.getByRole('button', { name: 'Add effect', exact: true }).count() === 0) await effects.click();
	await expect(panel.getByRole('group', { name: 'Echo', exact: true })).toBeVisible();
});

test('a clip Auto Duck can select another track without offering its own input as a detector', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await importFiles(editor, [toneA, toneB]);
	const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await panel.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, panel, 'track', 'Auto Duck');
	const dialog = page.getByRole('dialog', { name: 'Auto Duck', exact: true });
	const control = dialog.getByRole('group', { name: 'Control track', exact: true });
	await expect(control).toContainText('browser-tone-b');
	await control.getByRole('button', { exact: false }).click();
	const options = page.getByRole('listbox');
	await expect(options.getByRole('option', { name: 'browser-tone-b', exact: true })).toBeVisible();
	await expect(options.getByRole('option', { name: 'browser-tone-a', exact: true })).toHaveCount(0);
});

test('adding a second clip Auto Duck cannot create a reciprocal detector loop', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await importFiles(editor, [toneA, toneB]);
	let panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await panel.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, panel, 'track', 'Auto Duck');
	await closeDialog(page.getByRole('dialog', { name: 'Auto Duck', exact: true }));
	panel = await openClipProperties(page, editor, clipByName(editor, toneB.name));
	await panel.getByText('Effects', { exact: true }).click();
	await panel.getByRole('button', { name: 'Add effect', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Auto Duck', exact: true }).click();
	await expect(editor.getByRole('alert')).toContainText(/Auto Duck/u);
	await expect(panel.getByRole('group', { name: 'Auto Duck', exact: true })).toHaveCount(0);
});

test('activating a saved playlist cannot introduce a reciprocal clip detector loop', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await importFiles(editor, [toneA, toneB]);
	const trackId = await clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]').getAttribute('data-track-id');
	let panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await panel.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, panel, 'track', 'Auto Duck');
	await closeDialog(page.getByRole('dialog', { name: 'Auto Duck', exact: true }));
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Track playlists']);
	let playlists = page.getByRole('dialog', { name: 'Track playlists', exact: true });
	await playlists.getByRole('textbox', { name: 'Playlist name', exact: true }).fill('No detector');
	await playlists.getByRole('button', { name: 'Create empty playlist', exact: true }).click();
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
	await playlists.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click();
	panel = await openClipProperties(page, editor, clipByName(editor, toneB.name));
	await panel.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, panel, 'track', 'Auto Duck');
	await closeDialog(page.getByRole('dialog', { name: 'Auto Duck', exact: true }));
	await editor.locator(`[data-track-row][data-track-id="${trackId}"] [data-track-header]`).click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Track playlists']);
	playlists = page.getByRole('dialog', { name: 'Track playlists', exact: true });
	await playlists.getByRole('listbox', { name: 'Playlists', exact: true }).selectOption({ label: 'Original' });
	await playlists.getByRole('button', { name: 'Activate playlist', exact: true }).click();
	await expect(playlists.getByRole('alert')).toContainText('Auto Duck');
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
	await expect(playlists.getByRole('option', { name: 'No detector (active)', exact: true })).toHaveCount(1);
});
