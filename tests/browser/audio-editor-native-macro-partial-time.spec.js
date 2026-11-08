/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, importFiles, clipByName } from './audio-editor-test-helpers.js';

for (const explicitEnd of [true, false]) test(`native macro time defaults survive import with explicitEnd=${explicitEnd}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const choosing = page.waitForEvent('filechooser'); await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native partial.txt', mimeType: 'text/plain',
		buffer: Buffer.from(`SelectAll:\nSelectTime:Start="0.2"${explicitEnd ? ' End="0"' : ''}\n`) });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Native partial');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(editor.locator('[data-status]')).toHaveText('Done'); await closeDialog(manager);
	for (const [name, frames] of [['Selection start', 0], ['Selection end', 9600]]) {
		const group = editor.getByRole('group', { name, exact: true });
		await group.locator('.timecode__format-button').click(); await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await expect(group.locator('.timecode-digit')).toHaveText([...String(frames).padStart(12, '0')]);
	}
});

for (const partial of [false, true]) test(`native macro frequency defaults survive import with partial=${partial}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click(); await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const choosing = page.waitForEvent('filechooser'); await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native frequency.txt', mimeType: 'text/plain',
		buffer: Buffer.from(`SelectAll:\nSelectFrequencies:${partial ? 'Low="500"' : 'Low="0" High="500"'}\n`) });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Native frequency');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click(); await expect(editor.locator('[data-status]')).toHaveText('Done'); await closeDialog(manager);
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	const range = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await expect(range.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u })).toHaveValue('0');
	await expect(range.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u })).toHaveValue('500');
});
