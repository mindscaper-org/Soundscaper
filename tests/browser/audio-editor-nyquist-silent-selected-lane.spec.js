/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, closeClipProperties, importFiles, openClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';

test('the existing Nyquist Prompt applies one shared insertion across selected quiet lanes', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const files = [440,660].map((frequency,index) => createWavFixture({ name:`nyquist-quiet-${index}.wav`,frequency,duration:1,channelCount:1 }));
	await importFiles(editor, files);
	const properties = await openClipProperties(page, editor, clipByName(editor, files[1].name));
	await showClipTimingFields(properties); await setClipTimeFrames(properties, 'startFrame', 144000); await closeClipProperties(properties);
	await clipByName(editor, files[0].name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks','Select all tracks']);
	await expect(editor.getByRole('group', { name:'Selection start',exact:true }).locator('.timecode__display')).toHaveText('00h00m00.000s');
	await expect(editor.getByRole('group', { name:'Selection end',exact:true }).locator('.timecode__display')).toHaveText('00h00m01.000s');
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const prompt = page.getByRole('dialog', { name:'Nyquist prompt',exact:true });
	await prompt.getByRole('textbox', { name:'Nyquist source',exact:true }).fill('(let ((track *track*)) (seq (cue track) (cue track)))');
	await prompt.getByRole('button', { name:'Run',exact:true }).click();
	await expect(prompt.locator('.kw-audio-editor__nyquist-output')).toContainText('96000 frames', {timeout:20000});
	await prompt.getByRole('button', { name:'Cancel',exact:true }).click();
	await expect(editor.getByRole('group', { name: /^Audio clip clip, starts at 0 seconds, 2 seconds long/u }).first()).toBeVisible();
	await expect(clipByName(editor, files[1].name)).toHaveAttribute('aria-label', /starts at 4 seconds/u);
});
