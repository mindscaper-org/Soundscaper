/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, clipByName, closeDialog, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('moving a surround clip into an active mono Reverb rack refuses the transfer before changing its owner', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const mono = createWavFixture({ name: 'Mono room.wav', channelCount: 1, duration: .5, frequency: 440 });
	const surround = createWavFixture({ name: 'Surround donor.wav', channelCount: 6, duration: .5, frequency: 440 });
	await importFiles(editor, [mono, surround]);
	const clip = clipByName(editor, surround.name);
	const donorId = await clip.locator('xpath=ancestor::div[@data-track-row]').getAttribute('data-track-row');
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Reverb');
	await closeDialog(page.getByRole('dialog', { name: 'Reverb', exact: true }));
	await clip.locator('.clip-header').click({ button: 'right' });
	const move = page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
	await move.hover();
	await move.getByRole('menuitem', { name: /Mono room/u }).click();
	await expect(editor.getByRole('alert')).toContainText('This effect is not supported.');
	await expect(clip.locator('xpath=ancestor::div[@data-track-row]')).toHaveAttribute('data-track-row', donorId);
	await expect(clipByName(editor, mono.name)).toBeVisible();
});
