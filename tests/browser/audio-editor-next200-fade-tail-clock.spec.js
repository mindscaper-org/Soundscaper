/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker,
	downloadBytes, importFiles, openClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';

for (const changing of [true, false]) test(`a musical fade-out counts back from its tail with ${changing ? 'changing' : 'constant'} tempo`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await importFiles(editor, [createWavFixture({ name: 'Fade tail.wav', duration: 6, frequency: 440 })]);
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await tempo.fill('60'); await tempo.press('Enter');
	if (changing) {
		await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
		const musical = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
		await musical.getByRole('button', { name: 'Add tempo event', exact: true }).click();
		const second = musical.getByRole('form', { name: 'Tempo event 2', exact: true });
		await expect(second.locator('[name="beatNum"]')).toHaveValue('4');
		await second.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true }).fill('120');
		await second.getByRole('button', { name: 'Save', exact: true }).click();
		await page.keyboard.press('Escape');
	}
	const properties = await openClipProperties(page, editor);
	await showClipTimingFields(properties);
	const fade = properties.locator('[data-clip-field="fadeOutFrame"]');
	await fade.locator('.timecode__display').dblclick();
	await fade.getByRole('textbox').fill('00:00:00.000'); await fade.getByRole('textbox').press('Enter');
	await expect(fade.locator('[data-timecode-direct-entry]')).toHaveValue('0');
	await fade.getByRole('button', { name: 'Fade out: format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
	await fade.locator('.timecode-digit').first().click();
	await page.keyboard.type('0011'); await page.keyboard.press('Enter');
	await expect(fade.locator('[data-timecode-direct-entry]')).toHaveValue(String(changing ? 96_000 : 192_000));
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fade.locator('[data-timecode-direct-entry]')).toHaveValue('0');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(fade.locator('[data-timecode-direct-entry]')).toHaveValue(String(changing ? 96_000 : 192_000));
	const download = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const files = unzipSync(await downloadBytes(await download));
	const project = JSON.parse(strFromU8(files['project.json']));
	expect(project.clips[0].fadeOutFrames).toBe(changing ? 96_000 : 192_000);
});
