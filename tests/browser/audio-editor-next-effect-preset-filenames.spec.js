/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, disableNativeSavePicker, downloadBytes, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

for (const rack of [false, true]) test(`Unicode preset downloads retain their distinct names; rack=${rack}`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	let dialog;
	if (rack) {
		const effects = await openEffectsForTrack(editor, 1); await addRackEffect(page, effects, 'track', 'Noise gate');
		dialog = page.getByRole('dialog', { name: 'Noise gate', exact: true });
	} else {
		await page.keyboard.press('Control+k'); await editor.locator('[data-editor-search-input]').fill('Reverb');
		await editor.locator('[data-editor-search-popup] [data-editor-search-key="command:audacity-reverb"]').click();
		dialog = page.locator('[data-selection-effects-dialog]');
	}
	for (const name of ['ラジオ', '音楽']) {
		await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
		const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
		await prompt.getByRole('textbox').fill(name);
		await prompt.getByRole('button', { name: 'Save preset', exact: true }).click();
		await expect(prompt).toBeHidden();
		await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText(name);
		await dialog.getByRole('button', { name: 'More options', exact: true }).click();
		const downloading = page.waitForEvent('download');
		await page.getByRole('menuitem', { name: 'Export preset', exact: true }).click();
		const download = await downloading;
		expect(download.suggestedFilename()).toBe(`${name}.json`);
		const saved = JSON.parse(new TextDecoder().decode(await downloadBytes(download)));
		expect(saved.presets[0].name).toBe(name);
	}
});
