/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openEffectsForTrack, openRackPicker } from './audio-editor-test-helpers.js';

test('a surround recording cannot choose a known stereo-only rack effect', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Surround.wav', channelCount: 6, duration: .1, frequency: 440,
		channelAmplitudes: [0, 0, 0, 0, .5, 0] })]);
	const panel = await openEffectsForTrack(editor, 1);
	await openRackPicker(panel);
	const picker = page.getByRole('menu', { name: 'Choose an effect', exact: true });
	await expect(picker.getByRole('menuitem', { name: 'Reverb', exact: true })).toBeDisabled();
	await expect(picker.getByRole('menuitem', { name: 'Feedback delay', exact: true })).toBeEnabled();
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
