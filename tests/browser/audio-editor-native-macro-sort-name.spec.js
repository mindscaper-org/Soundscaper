/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, chooseCommandAction, closeDialog, importFiles } from './audio-editor-test-helpers.js';

for (const lowercaseFirst of [true, false]) test(`native SortByName removes the lowercase owner with lowercaseFirst=${lowercaseFirst}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await editor.locator('[data-track-row]').first().locator('.track-control-panel__track-name-text').click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
	const upper = { ...toneA, name: 'B.wav' }, lower = { ...toneB, name: 'b.wav' };
	await importFiles(editor, lowercaseFirst ? [lower, upper] : [upper, lower]);
	await expect(editor.locator('[data-track-row]')).toHaveCount(2);
	const names = editor.locator('[data-track-row] .track-control-panel__track-name-text');
	const before = await names.allTextContents();
	expect(before.map(value => value.replace(/\.wav$/u, ''))).toEqual(lowercaseFirst ? ['b', 'B'] : ['B', 'b']);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const choosing = page.waitForEvent('filechooser');
	await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native name ordering.txt', mimeType: 'text/plain',
		buffer: Buffer.from('SortByName:\nSelectTracks:Track="0" TrackCount="1" Mode="Set"\nRemoveTracks:\n') });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Native name ordering');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(editor.locator('[data-status]')).toHaveText('Done'); await closeDialog(manager);
	expect(await names.allTextContents()).toEqual([before.find(value => value.startsWith('B'))]);
});

test('legacy native SortByName shortcuts decline the local case-fold ordering', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const choosing = page.waitForEvent('filechooser');
	await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native name sort.xml', mimeType: 'application/xml',
		buffer: Buffer.from('<audacitykeyboard><command name="SortByName" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>') });
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 1 skipped.');
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
	await review.getByText('Skipped shortcuts', { exact: true }).click();
	await expect(review.getByRole('listitem')).toHaveText('SortByName: Command unavailable');
});
