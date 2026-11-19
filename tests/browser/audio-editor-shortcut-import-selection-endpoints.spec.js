/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

async function selectRange(page, editor) {
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	for (const [name, frame] of [['Selection start', 9600], ['Selection end', 19200]]) {
		const control = editor.getByRole('group', { name, exact: true });
		await control.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await control.locator('.timecode-digit').first().click();
		await page.keyboard.type(String(frame).padStart(12, '0')); await page.keyboard.press('Enter');
		await expect(control.locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
	}
}

async function importReview(page, editor, xml) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const choosing = page.waitForEvent('filechooser');
	await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'audacity.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	await expect(preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true })).toBeEnabled({ timeout: 15_000 });
	return { preferences, review: preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true }) };
}

test('the modern playhead-anchored action retains its ordinary local selection behavior', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false }); await selectRange(page, editor);
	const { preferences, review } = await importReview(page, editor,
		'<Shortcuts><SC><key>track-start-cursor</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>');
	await expect(review.getByRole('status')).toHaveText('1 command ready to import; 0 skipped.');
	await review.getByRole('button', { name: 'Apply shortcuts', exact: true }).click();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
	await page.keyboard.press('Control+Alt+Shift+F7');
	for (const [name, frame] of [['Selection start', 0], ['Selection end', 9600]]) {
		await expect(editor.getByRole('group', { name, exact: true }).locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
	}
});
