/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog, importFiles, clipByName,
	openClipProperties, closeClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';

for (const scenario of [
	{ offset: 0, empty: false, local: false, expectedStart: 0 },
	{ offset: 9600, empty: false, local: false, expectedStart: 9600 },
	{ offset: 9600, empty: true, local: false, expectedStart: 0 },
	{ offset: 9600, empty: false, local: true, expectedStart: 0 },
]) test(`all-selection origin with offset=${scenario.offset}, empty=${scenario.empty}, local=${scenario.local}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	if (!scenario.empty) {
		await editor.locator('[data-track-row]').first().locator('.track-control-panel__track-name-text').click();
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
	}
	await importFiles(editor, [toneA]);
	await expect(editor.locator('[data-track-row]')).toHaveCount(scenario.empty ? 2 : 1);
	if (scenario.offset) {
		const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));
		await showClipTimingFields(properties); await setClipTimeFrames(properties, 'startFrame', scenario.offset); await closeClipProperties(properties);
	}
	if (scenario.local) await chooseCommandAction(page, editor, 'Select', 'Select all');
	else {
		await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
		const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
		const choosing = page.waitForEvent('filechooser'); await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
		await (await choosing).setFiles({ name: 'Native all range.txt', mimeType: 'text/plain', buffer: Buffer.from('SelectAll:\n') });
		await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Native all range');
		await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
		await expect(editor.locator('[data-status]')).toHaveText('Done'); await closeDialog(manager);
	}
	for (const [name, frame] of [['Selection start', scenario.expectedStart], ['Selection end', scenario.offset + 38400]]) {
		const group = editor.getByRole('group', { name, exact: true });
		await group.locator('.timecode__format-button').click(); await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await expect(group.locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
	}
});
