/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction } from './audio-editor-test-helpers.js';

for (const docked of [false, true]) test(`the playhead clock reaches a CUE marker beyond audio; docked=${docked}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Album.cue', mimeType: 'application/x-cue', buffer: Buffer.from(
		'FILE "Album.wav" WAVE\n TRACK 01 AUDIO\n TITLE "Ten minute cue"\n INDEX 01 10:00:00\n') });
	const destination = page.locator('[data-cue-import-choice]');
	await destination.getByRole('button', { name: 'Markers', exact: true }).click();
	await expect(destination).toBeHidden();
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	await expect(editor.getByRole('list', { name: 'Marker and region list' })).toContainText('Ten minute cue');
	if (docked) await chooseCommandAction(page, editor, 'Window', 'Clock');
	const clock = docked ? editor.locator('[data-clock-panel]') : editor.locator('[data-editor-tool-toolbar] [data-time-display]');
	await clock.locator('.timecode__display').dblclick();
	const input = clock.locator('input'); await input.fill('600'); await input.press('Enter');
	await expect(clock.locator('.timecode__display')).toHaveText('00h10m00.00s');
});
