/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

async function openTone(page) {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	return page.getByRole('dialog', { name: 'Tone', exact: true });
}

async function openAmplifyGainField(page) {
	const dialog = await openTone(page);
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden();
	const editor = page.locator('[data-audio-editor]');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
	const amplify = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const gain = amplify.locator('[data-effect-param="gainDb"]');
	// The generated tone peaks at 0.8. Wait for Amplify's asynchronous peak scan.
	await expect(gain.getByRole('slider').first()).toHaveValue('1.9');
	return gain;
}

test('clearing an effect number refuses the empty value instead of changing it to zero', async ({ page }) => {
	const field = await openAmplifyGainField(page);
	const number = field.getByRole('spinbutton');
	await commitInput(number, '-6');
	await expect(field.getByRole('slider').first()).toHaveValue('-6');
	await commitInput(number, '');
	await expect(field.getByRole('slider').first()).toHaveValue('-6');
});

test('rejected effect numbers expose their error to assistive technology', async ({ page }) => {
	const field = await openAmplifyGainField(page);
	const number = field.getByRole('spinbutton');
	await commitInput(number, '1000');
	await expect(number).toHaveAttribute('aria-invalid', 'true');
});

