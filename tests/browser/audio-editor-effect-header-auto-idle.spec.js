/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, importFiles, waitForEditor } from './audio-editor-test-helpers.js';
import { openInstalledGain } from './helpers/native-plugin-parameter-host.js';

async function openReverb(page) {
	await page.keyboard.press('Control+k');
	await page.locator('[data-editor-search-input]').fill('Reverb');
	await page.locator('[data-editor-search-key="command:audacity-reverb"]').click();
	return page.locator('[data-selection-effects-dialog]');
}

async function openAdvanced(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await dialog.getByRole('tab', { name: /Advanced$/u }).click();
	return dialog;
}

test('effect auto-idle follows the global default until changed and remembers its override after reload', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	let effect = await openReverb(page);
	await effect.getByRole('button', { name: 'More options', exact: true }).click();
	await expect(page.getByRole('menuitemcheckbox', { name: 'Auto-idle', exact: true })).toBeChecked();
	await page.keyboard.press('Escape');
	await closeDialog(effect);
	let preferences = await openAdvanced(page, editor);
	await preferences.getByRole('checkbox', { name: 'Suspend idle effect processing', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	effect = await openReverb(page);
	await effect.getByRole('button', { name: 'More options', exact: true }).click();
	const autoIdle = page.getByRole('menuitemcheckbox', { name: 'Auto-idle', exact: true });
	await expect(autoIdle).not.toBeChecked();
	await autoIdle.click();
	await closeDialog(effect);
	preferences = await openAdvanced(page, editor);
	await expect(preferences.getByRole('checkbox', { name: 'Reverb (Audacity)', exact: true })).toBeChecked();
	await preferences.getByRole('checkbox', { name: 'Suspend idle effect processing', exact: true }).check();
	await preferences.getByRole('checkbox', { name: 'Suspend idle effect processing', exact: true }).uncheck();
	await expect(preferences.getByRole('checkbox', { name: 'Reverb (Audacity)', exact: true })).toBeChecked();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload(); editor = await waitForEditor(page);
	effect = await openReverb(page);
	await effect.getByRole('button', { name: 'More options', exact: true }).click();
	await expect(page.getByRole('menuitemcheckbox', { name: 'Auto-idle', exact: true })).toBeChecked();
	await page.keyboard.press('Escape'); await closeDialog(effect);
	preferences = await openAdvanced(page, editor);
	await preferences.getByRole('button', { name: 'Use global preference: Reverb (Audacity)', exact: true }).click();
	await expect(preferences.getByRole('checkbox', { name: 'Reverb (Audacity)', exact: true })).toHaveCount(0);
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	effect = await openReverb(page);
	await effect.getByRole('button', { name: 'More options', exact: true }).click();
	await expect(page.getByRole('menuitemcheckbox', { name: 'Auto-idle', exact: true })).not.toBeChecked();
});

test('native plug-ins share preset save, reset, delete, bypass and auto-idle controls', async ({ page }) => {
	const dialog = await openInstalledGain(page, { allowBypass: true });
	const gain = dialog.locator('[data-native-plugin-parameter="gain"]');
	await expect(gain).toHaveValue('0.25');
	await gain.press('End'); await expect(gain).toHaveValue('1');
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const naming = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await naming.getByRole('textbox').fill('Full gain');
	await naming.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(naming).toBeHidden();
	await expect(dialog.getByRole('button', { name: /^Preset:/u })).toContainText('Full gain');
	await gain.press('Home'); await expect(gain).toHaveValue('0');
	await dialog.getByRole('button', { name: 'Reset preset', exact: true }).click();
	await expect(gain).toHaveValue('1');
	await dialog.getByRole('button', { name: 'More options', exact: true }).click();
	await page.getByRole('menuitemcheckbox', { name: 'Auto-idle', exact: true }).click();
	await dialog.getByRole('button', { name: 'Delete preset', exact: true }).click();
	await expect(dialog.getByRole('button', { name: /^Preset:/u })).toContainText('No preset');
	await dialog.getByRole('button', { name: 'Disable effect', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Enable effect', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	const preferences = await openAdvanced(page, page.locator('[data-audio-editor]'));
	await expect(preferences.getByRole('checkbox', { name: 'Test Gain (LADSPA)', exact: true })).not.toBeChecked();
	await preferences.getByRole('checkbox', { name: 'Suspend idle effect processing', exact: true }).uncheck();
	await preferences.getByRole('checkbox', { name: 'Suspend idle effect processing', exact: true }).check();
	await expect(preferences.getByRole('checkbox', { name: 'Test Gain (LADSPA)', exact: true })).not.toBeChecked();
});

test('offline Nyquist presets restore source and language through the shared header', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	const language = dialog.getByRole('combobox', { name: 'Language', exact: true });
	const source = dialog.getByRole('textbox', { name: 'Nyquist source', exact: true });
	await language.selectOption('sal'); await source.fill('return 42');
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const naming = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await naming.getByRole('textbox').fill('Answer');
	await naming.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(naming).toBeHidden();
	await language.selectOption('lisp'); await source.fill('(+ 1 2)');
	await dialog.getByRole('button', { name: 'Reset preset', exact: true }).click();
	await expect(language).toHaveValue('sal'); await expect(source).toHaveValue('return 42');
	await dialog.getByRole('button', { name: 'More options', exact: true }).click();
	await expect(page.getByRole('menuitemcheckbox', { name: 'Auto-idle', exact: true })).toBeDisabled();
	await page.keyboard.press('Escape'); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	await dialog.getByRole('button', { name: /^Preset:/u }).click();
	await page.getByRole('option', { name: 'Answer (custom)', exact: true }).click();
	await expect(language).toHaveValue('sal'); await expect(source).toHaveValue('return 42');
});
