/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { expectClipSampleRate } from './audio-editor-clip-settings-test-helpers.js';
import { bootEditor, chooseCommandAction, clipByName, getMenuItem, importFiles,
	openClipProperties, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Tracks Resample remains unavailable until its recording track is unlocked', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name).first();
	const clipId = await clip.getAttribute('data-clip-id');
	expect(clipId).not.toBeNull();
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	await clip.locator('.clip-header').click();
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	const tracks = await openNestedCommandMenu(page, editor, 'Tracks', []);
	await expect(getMenuItem(tracks, 'Resample')).toBeDisabled();
	await page.keyboard.press('Escape');
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await chooseCommandAction(page, editor, 'Tracks', 'Resample');
	const dialog = page.getByRole('dialog', { name: 'Resample', exact: true });
	await dialog.locator('input').fill('24000');
	await dialog.getByRole('button', { name: 'Resample', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 10000 });
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expectClipSampleRate(await openClipProperties(page, editor, editor.locator(`[data-clip-id="${clipId}"][role="group"]`)), 24000);
});
