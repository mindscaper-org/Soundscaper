/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction } from './audio-editor-test-helpers.js';

test('Fit project reveals markers from an ordinary long CUE sheet opened without media', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'album.cue', mimeType: 'application/x-cue',
		buffer: Buffer.from('FILE "album.wav" WAVE\n TRACK 01 AUDIO\n TITLE "Ten minute cue"\n INDEX 01 10:00:00\n') });
	const dialog = page.locator('[data-cue-import-choice]');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Markers', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	await expect(editor.getByRole('list', { name: 'Marker and region list' })).toContainText('Ten minute cue');
	await chooseCommandAction(page, editor, 'View', 'Markers');
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	await expect(editor.locator('[data-timeline-annotation-layer]').getByRole('option', { name: /Ten minute cue/u })).toBeInViewport();
});
