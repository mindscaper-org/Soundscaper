/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
	importFiles, openSourceMonitor } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const changesLength of [true, false]) test(`the next Source monitor effect keeps the complete ${changesLength ? 'repeated' : 'same-length'} result selected`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'Selected result.wav', duration: 1, frequency: 440, channelCount: 1 });
	await importFiles(editor, [file]);
	const panel = await openSourceMonitor(page, editor, clipByName(editor, file.name));
	const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus(); await waveform.press('Control+a');
	if (changesLength) {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Repeat']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await dialog.getByRole('spinbutton', { name: 'Number of repeats', exact: true }).fill('1');
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20_000 });
	} else {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.');
	}
	const before = await exportSamples(page, editor);
	expect(before.length).toBe(changesLength ? 96_000 : 48_000);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.');
	const after = await exportSamples(page, editor);
	expect(after).toHaveLength(before.length);
	const error = after.reduce((maximum, sample, index) => Math.max(maximum, Math.abs(sample + before[index])), 0);
	expect(error).toBeLessThan(.0001);
});
