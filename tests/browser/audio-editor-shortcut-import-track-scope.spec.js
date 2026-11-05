/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, clipByName } from './audio-editor-test-helpers.js';

async function importReview(page, editor, xml) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const choosing = page.waitForEvent('filechooser');
	await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'audacity.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	return { preferences, review: preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true }) };
}

for (const [command, xml] of [
	['TrackClose', '<audacitykeyboard audacityversion="3.7.7"><command name="TrackClose" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>'],
	['track-close', '<Shortcuts><SC><key>track-close</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>'],
]) test(`shortcut import refuses ${command} without deleting selected peer tracks`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [toneA, toneB]);
	const { preferences, review } = await importReview(page, editor, xml);
	await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 1 skipped.');
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
	await review.getByText('Skipped shortcuts', { exact: true }).click();
	await expect(review.getByRole('listitem')).toHaveText(`${command}: Command unavailable`);
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await clipByName(editor, toneB.name).locator('.clip-header').click({ modifiers: ['Shift'] });
	await page.keyboard.press('Control+Alt+Shift+F7');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});

test('the supported native RemoveTracks shortcut still removes the complete selection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [toneA, toneB]);
	const { preferences, review } = await importReview(page, editor,
		'<audacitykeyboard audacityversion="3.7.7"><command name="RemoveTracks" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>');
	await expect(review.getByRole('status')).toHaveText('1 command ready to import; 0 skipped.');
	await review.getByRole('button', { name: 'Apply shortcuts', exact: true }).click();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await clipByName(editor, toneB.name).locator('.clip-header').click({ modifiers: ['Shift'] });
	await page.keyboard.press('Control+Alt+Shift+F7');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
});
