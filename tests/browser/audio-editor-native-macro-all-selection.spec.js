/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, importFiles, clipByName } from './audio-editor-test-helpers.js';

for (const command of ['', 'SelectAll:', 'SelAllTracks:']) test(`native all-selection retains spectral scope with command=${command || 'unchanged'}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const choosing = page.waitForEvent('filechooser'); await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native broad selection.txt', mimeType: 'text/plain',
		buffer: Buffer.from(`SelectAll:\nSelectTime:Start="0.1" End="0.4"\nSelectFrequencies:Low="900" High="1100"\n${command}\n`) });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Native broad selection');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(editor.locator('[data-status]')).toHaveText('Done'); await closeDialog(manager);
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	const range = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await expect(range.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u })).toHaveValue('900');
	await expect(range.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u })).toHaveValue('1100');
});

test('legacy native all-selection shortcuts disclose differing spectral behavior', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const choosing = page.waitForEvent('filechooser'); await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'native.xml', mimeType: 'application/xml',
		buffer: Buffer.from('<audacitykeyboard audacityversion="3.7.7"><command name="SelectAll" key="Ctrl+Alt+Shift+F7"/><command name="SelAllTracks" key="Ctrl+Alt+Shift+F8"/></audacitykeyboard>') });
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 2 skipped.');
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
});
