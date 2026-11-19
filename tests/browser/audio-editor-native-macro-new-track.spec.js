/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog, importFiles } from './audio-editor-test-helpers.js';

// Command variants also pass through persisted macro-library and Scape custody in Node.
test('native macro file import selects its new mono lane before RemoveTracks', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await editor.locator('[data-track-row]').first().locator('.track-control-panel__track-name-text').click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
	await importFiles(editor, [toneA]); await expect(editor.locator('[data-track-row]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const names = await editor.locator('[data-track-row] .track-control-panel__track-name-text').allTextContents();
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	const choosing = page.waitForEvent('filechooser'); await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	const source = 'NewMonoTrack:\nRemoveTracks:\n';
	await (await choosing).setFiles({ name: 'Create and remove temporary lane.txt', mimeType: 'text/plain', buffer: Buffer.from(source) });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Create and remove temporary lane');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(editor.locator('[data-status]')).toHaveText('Done'); await closeDialog(manager);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-track-row] .track-control-panel__track-name-text')).toHaveText(names);
});
