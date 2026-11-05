/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

async function prepare(page, editor, point = false) {
	await importFiles(editor, [toneA]); await chooseCommandAction(page, editor, 'Select', 'Select all');
	for (const [name, frame] of [['Selection start', 9600], ['Selection end', point ? 9600 : 19200]]) {
		const group = editor.getByRole('group', { name, exact: true });
		await group.locator('.timecode__format-button').click(); await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await group.locator('.timecode-digit').first().click(); await page.keyboard.type(String(frame).padStart(12, '0')); await page.keyboard.press('Enter');
		await expect(group.locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
	}
}
async function importReview(page, editor, xml) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click(); const choosing = page.waitForEvent('filechooser');
	await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'audacity.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	return { preferences, review: preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true }) };
}
async function samplePlayhead(page, editor) {
	const playhead = editor.getByRole('group', { name: 'Playhead', exact: true });
	await playhead.locator('.timecode__format-button').click(); await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(playhead.locator('.timecode-digit')).toHaveText([...String(9600).padStart(12, '0')]);
	await playhead.focus(); return playhead;
}

for (const command of ['CursorRight', 'CursorLongJumpRight']) test(`legacy ${command} refuses to skip native stopped range collapse`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/'); await prepare(page, editor);
	const { preferences, review } = await importReview(page, editor, `<audacitykeyboard audacityversion="3.7.7"><command name="${command}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`);
	await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 1 skipped.');
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
	await review.getByText('Skipped shortcuts', { exact: true }).click(); await expect(review.getByRole('listitem')).toHaveText(`${command}: Command unavailable`);
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const playhead = await samplePlayhead(page, editor); await page.keyboard.press('Control+Alt+Shift+F7');
	await expect(playhead.locator('.timecode-digit')).toHaveText([...String(9600).padStart(12, '0')]);
	for (const [name, frame] of [['Selection start', 9600], ['Selection end', 19200]]) await expect(editor.getByRole('group', { name, exact: true }).locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
});

test('the modern local cursor step still advances a stopped point cursor', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/'); await prepare(page, editor, true);
	const { preferences, review } = await importReview(page, editor, '<Shortcuts><SC><key>play-position-increase</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>');
	await expect(review.getByRole('status')).toHaveText('1 command ready to import; 0 skipped.');
	await review.getByRole('button', { name: 'Apply shortcuts', exact: true }).click(); await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const playhead = await samplePlayhead(page, editor); await page.keyboard.press('Control+Alt+Shift+F7');
	await expect.poll(async () => Number((await playhead.locator('.timecode-digit').allTextContents()).join(''))).toBeGreaterThan(9600);
});
