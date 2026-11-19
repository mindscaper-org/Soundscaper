/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, collectClientErrors, commitInput,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('first-party rack settings expose preset saving, reset and Auto-idle', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Automatic pitch correction');
	const settings = page.getByRole('dialog', { name: 'Automatic pitch correction', exact: true });
	const speed = settings.getByRole('spinbutton', { name: 'Retune speed', exact: true });
	await commitInput(speed, '0');
	const save = settings.getByRole('button', { name: 'Save preset', exact: true });
	await expect(save).toBeVisible();
	await save.click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const naming = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await naming.getByRole('textbox').fill('Fast correction');
	await naming.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(naming).toBeHidden();
	await commitInput(speed, '50');
	await settings.getByRole('button', { name: 'Reset preset', exact: true }).click();
	await expect(speed).toHaveValue('0');
	await settings.getByRole('button', { name: 'More options', exact: true }).click();
	const idle = page.getByRole('menuitemcheckbox', { name: 'Auto-idle', exact: true });
	await expect(idle).toBeChecked(); await idle.click();
	await settings.getByRole('button', { name: 'More options', exact: true }).click();
	await expect(page.getByRole('menuitemcheckbox', { name: 'Auto-idle', exact: true })).not.toBeChecked();
	await page.keyboard.press('Escape'); await closeDialog(settings);
	expect(errors).toEqual([]);
});
