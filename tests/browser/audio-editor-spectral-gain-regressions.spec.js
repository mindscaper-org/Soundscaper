/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('spectral amplification requires a gain inside its displayed bounds', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	// A short tone is enough to test the gain limits.
	await commitInput(tone.locator('[data-generator-field="durationSeconds"] input'), '0.25');
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Spectral editing', 'Spectral box select']);
	const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await expect(dialog).toBeVisible();
	const gain = dialog.getByRole('textbox', { name: /^Gain \(dB\)/u });
	const apply = dialog.getByRole('button', { name: 'Spectral Amplify', exact: true });
	await gain.fill('100');
	await expect(apply).toBeDisabled();
	await gain.fill('-100');
	await expect(apply).toBeDisabled();
	await gain.fill('-60');
	await expect(apply).toBeEnabled();
	await apply.click();
	await expect(dialog).toBeHidden();
});
