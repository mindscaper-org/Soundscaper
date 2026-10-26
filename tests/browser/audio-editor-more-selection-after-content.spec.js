/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('the selection toolbar can precisely extend generation beyond the imported clip', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'one second.wav', duration: 1, channelCount: 1 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const end = editor.getByRole('group', { name: 'Selection end', exact: true });
	await end.locator('.timecode__display').dblclick();
	await end.locator('input').fill('2');
	await end.locator('input').press('Enter');
	await expect(end.locator('.timecode__display')).toHaveText('00h00m02.000s');
	await chooseCommandAction(page, editor, 'Generate', 'Silence');
	const dialog = page.getByRole('dialog', { name: 'Silence', exact: true });
	await expect(dialog.getByRole('group', { name: 'Duration (seconds)', exact: true }).locator('.timecode__display')).toHaveText('00h00m02.000s');
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(Math.max(...project.clips.map(clip => clip.durationFrames))).toBe(project.sampleRate * 2);
});
