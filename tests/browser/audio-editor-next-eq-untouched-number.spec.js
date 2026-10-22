/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('merely inspecting a rounded EQ number preserves precision and pending Redo', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'EQ recording.wav', duration: .25, channelCount: 1 })]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Parametric EQ');
	const eq = page.locator('[data-parametric-eq]');
	const q = eq.getByRole('spinbutton', { name: 'Q', exact: true });
	const gain = eq.getByRole('spinbutton', { name: 'Gain (dB)', exact: true });
	await commitInput(q, '.1049');
	await expect(q).toHaveValue('0.1');
	await commitInput(gain, '4');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(gain).toHaveValue('0');
	const redo = editor.getByRole('button', { name: 'Redo', exact: true });
	await expect(redo).toBeEnabled();
	await q.focus();
	await q.press('Tab');
	await expect(redo).toBeEnabled();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(gain).toHaveValue('4');
});
