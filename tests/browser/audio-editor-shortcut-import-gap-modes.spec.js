/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, clipByName, openClipProperties, clipField } from './audio-editor-test-helpers.js';

// Node persists and executes every native alias through the actual action handler.
for (const [command, expectedStart] of [['Cut', 0.2], ['SplitCut', 0.4]]) {
	test(`native ${command} import retains its fixed gap behavior for an ordinary selected range`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		for (const [name, frame] of [['Selection start', 9600], ['Selection end', 19200]]) {
			const control = editor.getByRole('group', { name, exact: true });
			await control.locator('.timecode__format-button').click();
			await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
			await control.locator('.timecode-digit').first().click();
			await page.keyboard.type(String(frame).padStart(12, '0')); await page.keyboard.press('Enter');
			await expect(control.locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
		}
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		const choosing = page.waitForEvent('filechooser');
		await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
		await (await choosing).setFiles({ name: 'audacity.xml', mimeType: 'application/xml',
			buffer: Buffer.from(`<audacitykeyboard audacityversion="3.7.7"><command name="${command}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`) });
		await expect(preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true })).toBeEnabled({ timeout: 15_000 });
		const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
		await expect(review.getByRole('status')).toHaveText('1 command ready to import; 0 skipped.');
		await review.getByRole('button', { name: 'Apply shortcuts', exact: true }).click();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
		await page.keyboard.press('Control+Alt+Shift+F7');
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name).last());
		await expect(clipField(properties, 'startFrame')).toHaveValue(String(expectedStart));
	});
}
