/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Make stereo offers only mono partners with the same mute and solo state', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const files = ['left', 'right'].map((name, index) => createWavFixture({ name: `${name}-mono.wav`,
		frequency: 330 + index * 110, duration: 0.5, channelCount: 1 }));
	await importFiles(editor, files);
	const left = clipByName(editor, files[0].name).locator('xpath=ancestor::div[@data-track-row]');
	const right = clipByName(editor, files[1].name).locator('xpath=ancestor::div[@data-track-row]');
	const rightId = await right.getAttribute('data-track-id');
	await right.getByRole('button', { name: 'Mute', exact: true }).click();
	await left.getByRole('button', { name: 'Track menu', exact: true }).click();
	await page.mouse.move(1, 1);
	const channels = page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: /^Track channels/u }).first();
	await channels.focus(); await channels.press('ArrowRight');
	await expect(channels.getByRole('menu').getByRole('menuitem', { name: /^Make stereo track/u }).first()).toBeDisabled();
	await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
	await left.getByRole('button', { name: 'Mute', exact: true }).click();
	await chooseTrackMenuAction(page, editor, left, ['Track channels', 'Make stereo track']);
	await expect(editor.locator(`[data-track-id="${rightId}"]`)).toHaveCount(0);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
