/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForEditor } from './audio-editor-test-helpers.js';

test('an Audacity Insert shortcut imports, runs and survives reopening the editor', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const choosing = page.waitForEvent('filechooser');
	await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'Insert-shortcuts.xml', mimeType: 'application/xml',
		buffer: Buffer.from('<Shortcuts><SC><key>new-mono-track</key><seq>Alt+Ins</seq></SC></Shortcuts>') });
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await expect(review.getByRole('status')).toHaveText('1 command ready to import; 0 skipped.');
	await review.getByRole('button', { name: 'Apply shortcuts', exact: true }).click();
	await expect(preferences.getByRole('status').filter({ hasText: 'Imported 1 command.' })).toBeVisible();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const tracks = editor.getByRole('group', { name: /, audio track$/u }); const initial = await tracks.count();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus(); await page.keyboard.press('Alt+Insert');
	await expect(tracks).toHaveCount(initial + 1);
	await page.reload(); editor = await waitForEditor(page);
	const reopened = editor.getByRole('group', { name: /, audio track$/u }); const before = await reopened.count();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus(); await page.keyboard.press('Alt+Insert');
	await expect(reopened).toHaveCount(before + 1);
});
