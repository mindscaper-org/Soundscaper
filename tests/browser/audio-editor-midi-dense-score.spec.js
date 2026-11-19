/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { denseMidiScoreFixture } from '../helpers/dense-midi-score-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('an imported dense MIDI score can be edited and undone in the Piano roll', async ({ page }, testInfo) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const file = testInfo.outputPath('Dense score.mid');
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, denseMidiScoreFixture());
	await importFiles(editor, file);
	await expect(clipByName(editor, 'Dense score')).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const notes = editor.getByRole('group', { name: 'Note editor', exact: true });
	await notes.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const pitch = notes.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true });
	await expect(pitch).toHaveValue('48');
	await pitch.fill('73');
	await pitch.press('Enter');
	await expect(pitch).toHaveValue('73');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(pitch).toHaveValue('48');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(pitch).toHaveValue('73');
});
