/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeDialog, importFiles } from './audio-editor-test-helpers.js';

test('aligning zero crossings preserves a selected spectral band', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill([
		'await sound.select.frames(4800, 33600);',
		'await sound.select.frequencies({ low: 100, high: 1000 });',
	].join('\n'));
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed');
	await closeDialog(manager);
	const options = editor.locator('[data-transport="play"]').getByRole('button', { name: 'Play options', exact: true });
	const command = page.getByRole('menu', { name: 'Play options', exact: true }).getByRole('menuitem', { name: 'Play selected frequencies', exact: true });
	await options.click();
	await expect(command).toHaveAttribute('aria-disabled', 'false');
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'Select', 'At zero crossings');
	await expect(editor.locator('[data-status]')).toHaveText('Moved selection to zero crossings.');
	await options.click();
	await expect(command).toHaveAttribute('aria-disabled', 'false');
});
