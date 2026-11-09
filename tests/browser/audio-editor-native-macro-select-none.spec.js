/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, importFiles } from './audio-editor-test-helpers.js';

for (const clear of [false, true]) test(`native deselection preserves a later relative macro origin with clear=${clear}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false }); await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const choosing = page.waitForEvent('filechooser'); await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native deselect.txt', mimeType: 'text/plain',
		buffer: Buffer.from(`SelectAll:\nSelectTime:Start="0.2" End="0.4"\n${clear ? 'SelectNone:\n' : ''}SelectTime:Start="0.1" End="0.3" RelativeTo="SelectionStart"\n`) });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Native deselect');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click(); await expect(editor.locator('[data-status]')).toHaveText('Done'); await closeDialog(manager);
	for (const [name, frames] of [['Selection start', 14_400], ['Selection end', 24_000]]) {
		const group = editor.getByRole('group', { name, exact: true });
		await group.locator('.timecode__format-button').click(); await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await expect(group.locator('.timecode-digit')).toHaveText([...String(frames).padStart(12, '0')]);
	}
});

test('legacy SelectNone shortcuts disclose the incompatible reset while local clear still works', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false }); await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const choosing = page.waitForEvent('filechooser'); await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'native.xml', mimeType: 'application/xml',
		buffer: Buffer.from('<audacitykeyboard audacityversion="3.7.7"><command name="SelectNone" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>') });
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await expect(preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true })).toBeEnabled({ timeout: 15_000 });
	await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 1 skipped.');
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await expect(editor.locator('[data-time-selection-overlay]')).not.toHaveCount(0);
	await page.keyboard.press('Control+Shift+A');
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(0);
});
