/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, importFiles, clipByName } from './audio-editor-test-helpers.js';

async function runNativeMacro(page, editor, source) {
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const choosing = page.waitForEvent('filechooser'); await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native clip.txt', mimeType: 'text/plain', buffer: Buffer.from(source) });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Native clip');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click(); await expect(editor.locator('[data-status]')).toHaveText('Done');
	await closeDialog(manager);
}

for (const navigate of [false, true]) test(`native clip navigation retains spectral scope with navigate=${navigate}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click(); await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await runNativeMacro(page, editor, `SelectAll:\nSelectTime:Start="0" End="${navigate ? '0' : '0.8'}"\nSelectFrequencies:Low="900" High="1100"\n${navigate ? 'SelNextClip:\n' : ''}`);
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	const range = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await expect(range.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u })).toHaveValue('900');
	await expect(range.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u })).toHaveValue('1100');
});

for (const navigate of [false, true]) test(`native aligned-track clip choice uses the earliest end with navigate=${navigate}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, createWavFixture({ name: 'short.wav', frequency: 660, duration: 0.6 })]);
	await runNativeMacro(page, editor, `SelectAll:\nSelectTime:Start="0" End="${navigate ? '0' : '0.6'}"\n${navigate ? 'SelNextClip:\n' : ''}`);
	const group = editor.getByRole('group', { name: 'Selection end', exact: true });
	await group.locator('.timecode__format-button').click(); await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(group.locator('.timecode-digit')).toHaveText([...'000000028800']);
});

test('legacy clip navigation shortcuts disclose their differing selection contract', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const choosing = page.waitForEvent('filechooser'); await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'native.xml', mimeType: 'application/xml', buffer: Buffer.from('<audacitykeyboard audacityversion="3.7.7"><command name="SelNextClip" key="Ctrl+Alt+Shift+F7"/><command name="SelPrevClip" key="Ctrl+Alt+Shift+F8"/></audacitykeyboard>') });
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 2 skipped.');
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
});
