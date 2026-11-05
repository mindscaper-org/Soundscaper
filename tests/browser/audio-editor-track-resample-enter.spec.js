/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeClipProperties, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { expectClipSampleRate } from './audio-editor-clip-settings-test-helpers.js';

test('Track Resample field Enter reaches the same confirmed operation as the footer', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const original = clipByName(editor, toneA.name).first();
	const clipId = await original.getAttribute('data-clip-id');
	const clip = editor.locator(`[data-clip-id="${clipId}"][role="group"]`);
	await clip.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tracks', 'Resample');
	let dialog = page.getByRole('dialog', { name: 'Resample', exact: true });
	await dialog.getByRole('textbox', { name: /^Sample rate \(Hz\)/u }).fill('24000');
	await dialog.getByRole('button', { name: 'Resample', exact: true }).click();
	await expect(dialog).toBeHidden();
	const properties = await openClipProperties(page, editor, clip);
	await expectClipSampleRate(properties, 24000);
	await closeClipProperties(properties);
	await chooseCommandAction(page, editor, 'Tracks', 'Resample');
	dialog = page.getByRole('dialog', { name: 'Resample', exact: true });
	const input = dialog.getByRole('textbox', { name: /^Sample rate \(Hz\)/u });
	await input.fill('48000');
	await input.press('Enter');
	await expect(dialog).toBeHidden({ timeout: 3000 });
	const restored = await openClipProperties(page, editor, clip);
	await expectClipSampleRate(restored, 48000);
});
