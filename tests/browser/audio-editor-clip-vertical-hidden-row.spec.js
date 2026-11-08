/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const direction of ['ArrowDown', 'ArrowUp']) test(`${direction} from an audio clip skips a collapsed folder's hidden clip`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const names = ['Visible first.wav', 'Collapsed middle.wav', 'Visible last.wav'];
	await importFiles(editor, names.map(name => createWavFixture({ name, duration: .2 })));
	const clips = names.map(name => clipByName(editor, name));
	const start = clips[direction === 'ArrowDown' ? 0 : 2];
	const destination = clips[direction === 'ArrowDown' ? 2 : 0];
	await start.focus();
	await start.press(direction);
	await expect(clips[1]).toBeFocused();
	await clips[1].locator('.clip-header').click();
	await chooseTrackMenuAction(page, editor, clips[1].locator('xpath=ancestor::div[@data-track-row][1]'), 'Move selection into new folder');
	const folder = editor.getByRole('treeitem');
	await folder.getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(clips[1]).toHaveCount(0);
	await start.focus();
	await start.press(direction);
	await expect(destination).toBeFocused();
	await folder.getByRole('button', { name: 'Expand folder', exact: true }).click();
	await start.focus();
	await start.press(direction);
	await expect(clips[1]).toBeFocused();
});
