/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog, importFiles } from './audio-editor-test-helpers.js';

for (const [command, explicit] of [['NewMonoTrack', false], ['NewStereoTrack', false], ['NewMonoTrack', true], ['NewLabelTrack', false], ['NewLabelTrack', true]]) {
	test(`native ${command} selects its created lane before RemoveTracks, explicit=${explicit}`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await editor.locator('[data-track-row]').first().locator('.track-control-panel__track-name-text').click();
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
		await importFiles(editor, [toneA]); await expect(editor.locator('[data-track-row]')).toHaveCount(1);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		const names = await editor.locator('[data-track-row] .track-control-panel__track-name-text').allTextContents();
		await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
		const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
		const choosing = page.waitForEvent('filechooser'); await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
		const source = `${command}:\n${explicit ? 'SelectTracks:Track="1" TrackCount="1" Mode="Set"\n' : ''}RemoveTracks:\n`;
		await (await choosing).setFiles({ name: 'Create and remove temporary lane.txt', mimeType: 'text/plain', buffer: Buffer.from(source) });
		await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Create and remove temporary lane');
		await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
		await expect(editor.locator('[data-status]')).toHaveText('Done'); await closeDialog(manager);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.locator('[data-track-row] .track-control-panel__track-name-text')).toHaveText(names);
	});
}
