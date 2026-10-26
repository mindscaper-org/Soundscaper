/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	closeDialog, closeEffectsPanel, getMenuItem, importFiles, openClipProperties, openEffectsForTrack,
} from './audio-editor-test-helpers.js';

test('NP019: Move to Project Bin retires the last clip freeze in one Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Feedback delay');
	await closeDialog(page.getByRole('dialog', { name: 'Feedback delay', exact: true }));
	await closeEffectsPanel(effects);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Window', ['History']);
	const history = editor.locator('[data-workspace-panel="history"] [data-history-list] > li');
	const count = await history.count();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Freeze track']);
	await expect(history).toHaveCount(count + 1, { timeout: 10_000 });
	await clip.locator('.clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	await expect(clip).toHaveCount(0, { timeout: 5_000 });
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect(history).toHaveCount(count + 2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip).toHaveCount(1);
	await editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: 'Tracks', exact: true }).click();
	await expect(getMenuItem(page.getByRole('menu', { name: 'Tracks', exact: true }), 'Freeze (fresh)')).toBeVisible();
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clip).toHaveCount(0);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});


test('NP019: clip properties track destination retires only the emptied freeze and remains undoable', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const clip = clipByName(editor, toneA.name);
	const originalTrack = await clip.locator('xpath=ancestor::*[@data-track-row][1]').getAttribute('data-track-id');
	const destination = clipByName(editor, toneB.name).locator('xpath=ancestor::*[@data-track-row][1]');
	const destinationId = await destination.getAttribute('data-track-id');
	const destinationName = (await destination.locator('.track-control-panel__track-name-text').textContent()).trim();
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Feedback delay');
	await closeDialog(page.getByRole('dialog', { name: 'Feedback delay', exact: true }));
	await closeEffectsPanel(effects);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Freeze track']);
	await expect(editor.locator('[data-task-progress]')).toHaveCount(0);
	const properties = await openClipProperties(page, editor, clip, { additional: false });
	await properties.getByRole('button', { name: 'Track', exact: true }).click();
	await page.getByRole('option', { name: destinationName, exact: true }).click();
	await expect(clip.locator('xpath=ancestor::*[@data-track-row][1]')).toHaveAttribute('data-track-id', destinationId);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip.locator('xpath=ancestor::*[@data-track-row][1]')).toHaveAttribute('data-track-id', originalTrack);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clip.locator('xpath=ancestor::*[@data-track-row][1]')).toHaveAttribute('data-track-id', destinationId);
});
