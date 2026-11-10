/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

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
