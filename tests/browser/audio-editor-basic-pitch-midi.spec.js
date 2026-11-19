/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';
import { completeMilestone7Run, installMilestone7LocalAssistanceFixture, milestone7FixtureSnapshot } from './helpers/milestone-7-local-assistance.js';

test('Basic Pitch advanced processing reviews notes and creates an undoable MIDI track alongside audio', async ({ page }) => {
	await installMilestone7LocalAssistanceFixture(page, [['basic-pitch', '1.0.0', 'music-transcription',
		'2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec']]);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const audio = createWavFixture({ name: 'piano-chords.wav', frequency: 330, duration: 2, sampleRate: 44_100, channelCount: 1 });
	await importFiles(editor, [audio]);
	await clipByName(editor, audio.name).click();
	await page.keyboard.press('Control+a');
	page.on('dialog', dialog => { void dialog.accept(); });
	await chooseCommandAction(page, editor, 'Tools', 'Advanced Local Processing');
	const dialog = page.getByRole('dialog', { name: 'Advanced Local Processing', exact: true });
	await dialog.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('music-transcription');
	await dialog.getByRole('button', { name: 'Analyze', exact: true }).click();
	await expect.poll(() => milestone7FixtureSnapshot(page).then(value => value.progressEvents)).toBe(1);
	await completeMilestone7Run(page);
	await dialog.getByRole('button', { name: 'Review result', exact: true }).click();
	await expect(dialog.getByText('3 detected notes.', { exact: false })).toBeVisible();
	await dialog.getByRole('button', { name: 'Accept proposal', exact: true }).click();
	await expect(dialog.getByText('The proposal was accepted.', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(clipByName(editor, audio.name)).toBeVisible();
	await expect(clipByName(editor, 'Basic Pitch')).toBeVisible();
	await chooseCommandAction(page, editor, 'Window', 'Piano roll (beta)');
	const notes = editor.getByRole('combobox', { name: 'Selected note', exact: true });
	await expect(notes.getByRole('option')).toHaveCount(4);
	await notes.selectOption({ index: 2 });
	await expect(editor.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('64');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clipByName(editor, 'Basic Pitch')).toHaveCount(0);
	await expect(clipByName(editor, audio.name)).toBeVisible();
	expect(errors).toEqual([]);
});
