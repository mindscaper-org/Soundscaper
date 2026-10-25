/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

async function openTone(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	return page.getByRole('dialog', { name: 'Tone', exact: true });
}

async function openAmplify(page) {
	const dialog = await openTone(page);
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden();
	const editor = page.locator('[data-audio-editor]');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
	return page.getByRole('dialog', { name: 'Apply effect', exact: true });
}

test('clearing an effect number refuses the empty value instead of changing it to zero', async ({ page }) => {
	const dialog = await openAmplify(page);
	const field = dialog.locator('[data-effect-param="gainDb"]');
	const number = field.getByRole('spinbutton');
	await commitInput(number, '-6');
	await expect(field.getByRole('slider').first()).toHaveValue('-6');
	await commitInput(number, '');
	await expect(field.getByRole('slider').first()).toHaveValue('-6');
});

test('rejected effect numbers expose their error to assistive technology', async ({ page }) => {
	const dialog = await openAmplify(page);
	const number = dialog.locator('[data-effect-param="gainDb"]').getByRole('spinbutton');
	await commitInput(number, '1000');
	await expect(number).toHaveAttribute('aria-invalid', 'true');
});

