/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('deleting labels in their manager retains the next row and creation keyboard actions', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	const add = panel.getByRole('button', { name: 'New label', exact: true });
	await add.click();
	await add.click();
	const remove = panel.getByRole('button', { name: /^Delete label:/ });
	await expect(remove).toHaveCount(2);
	await remove.first().focus();
	await remove.first().press('Enter');
	await expect(remove).toHaveCount(1);
	await expect(remove).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(remove).toHaveCount(0);
	await expect(add).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(remove).toHaveCount(1);
});

test('deleting a label in its manager skips a locked neighboring row when restoring focus', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, ['First', 'Locked', 'Following'].map(title => ({
		name: `${title}.srt`, mimeType: 'application/x-subrip',
		buffer: Buffer.from(`1\n00:00:01,000 --> 00:00:02,000\n${title}\n`),
	})));
	const lockedTrack = editor.locator('[data-label-track]').filter({
		has: page.getByRole('group', { name: 'Edit labels: Locked', exact: true }),
	});
	await chooseTrackMenuAction(page, editor, lockedTrack, 'Lock track');
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	const first = panel.getByRole('button', { name: 'Delete label: First', exact: true });
	const locked = panel.getByRole('button', { name: 'Delete label: Locked', exact: true });
	const following = panel.getByRole('button', { name: 'Delete label: Following', exact: true });
	await expect(panel.getByRole('button', { name: /^Delete label:/u })).toHaveCount(3);
	await expect(locked).toBeDisabled();
	await first.focus();
	await first.press('Enter');
	await expect(first).toHaveCount(0);
	await expect(following).toBeFocused();
});
