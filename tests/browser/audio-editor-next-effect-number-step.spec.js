/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('Phaser numeric keyboard edits use their authored fractional parameter steps', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Phaser voice.wav', duration: .25, channelCount: 1 })]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Phaser');
	const dialog = page.getByRole('dialog', { name: 'Phaser', exact: true });
	const frequency = dialog.locator('[data-effect-param="frequency"]').getByRole('spinbutton');
	await expect(frequency).toHaveValue('0.4');
	await frequency.press('ArrowUp');
	await frequency.press('Tab');
	await expect(frequency).toHaveValue('0.401');
	const gain = dialog.locator('[data-effect-param="outputGainDb"]').getByRole('spinbutton');
	await expect(gain).toHaveValue('-6');
	await gain.press('ArrowUp');
	await gain.press('Tab');
	await expect(gain).toHaveValue('-5.9');
	await closeDialog(dialog);
	await panel.getByRole('group', { name: 'Phaser', exact: true }).getByRole('button', { name: 'Select effect', exact: true }).click();
	await expect(frequency).toHaveValue('0.401');
	await expect(gain).toHaveValue('-5.9');
});
