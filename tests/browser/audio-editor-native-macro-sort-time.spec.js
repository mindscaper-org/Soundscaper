/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog, importFiles, clipByName, openClipProperties, closeClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';

for (const empty of [true, false]) test(`native SortByTime preserves chronological lane order with empty=${empty}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	if (!empty) {
		await editor.locator('[data-track-row]').first().locator('.track-control-panel__track-name-text').click();
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
	}
	await importFiles(editor, empty ? [toneA] : [toneA, toneB]);
	await expect(editor.locator('[data-track-row]')).toHaveCount(2);
	const before = await editor.locator('[data-track-row] .track-control-panel__track-name-text').allTextContents();
	for (const [file, frame] of empty ? [[toneA, 9600]] : [[toneA, 19200], [toneB, 9600]]) {
		const properties = await openClipProperties(page, editor, clipByName(editor, file.name));
		await showClipTimingFields(properties); await setClipTimeFrames(properties, 'startFrame', frame); await closeClipProperties(properties);
	}
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const choosing = page.waitForEvent('filechooser'); await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native chronological sort.txt', mimeType: 'text/plain', buffer: Buffer.from('SortByTime:\n') });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Native chronological sort');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(editor.locator('[data-status]')).toHaveText('Done'); await closeDialog(manager);
	const after = await editor.locator('[data-track-row] .track-control-panel__track-name-text').allTextContents();
	expect(after).toEqual(empty ? before : [...before].reverse());
});

test('legacy native SortByTime shortcut truthfully declines changed empty-lane ordering', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const choosing = page.waitForEvent('filechooser');
	await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native sort.xml', mimeType: 'application/xml',
		buffer: Buffer.from('<audacitykeyboard><command name="SortByTime" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>') });
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 1 skipped.');
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
	await review.getByText('Skipped shortcuts', { exact: true }).click();
	await expect(review.getByRole('listitem')).toHaveText('SortByTime: Command unavailable');
});
