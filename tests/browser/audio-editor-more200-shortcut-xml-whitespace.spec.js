/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { largeAudacityShortcutXml } from '../helpers/audacity-large-shortcut-fixture.ts';

test('a formatted full shortcut file reviews skips and applies its supported command', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const choosing = page.waitForEvent('filechooser');
	await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'Full-shortcuts.xml', mimeType: 'application/xml', buffer: Buffer.from(largeAudacityShortcutXml(true)) });
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await expect(review.getByRole('status')).toHaveText('1 command ready to import; 900 skipped.');
	await review.getByRole('button', { name: 'Apply shortcuts', exact: true }).click();
	await expect(preferences.getByRole('status').filter({ hasText: 'Imported 1 command.' })).toBeVisible();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const tracks = editor.getByRole('group', { name: /, audio track$/u }); const before = await tracks.count();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus(); await page.keyboard.press('Alt+F10');
	await expect(tracks).toHaveCount(before + 1);
});
