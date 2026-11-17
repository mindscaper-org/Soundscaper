/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a sixteen-track Normalize macro fits the existing memory budget and produces normalized audio', async ({ page }) => {
	test.setTimeout(90000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Microphone.wav', frequency: 330, duration: 10 });
	await importFiles(editor, Array.from({ length: 16 }, (_, index) => ({ ...recording, name: `Microphone ${index + 1}.wav` })));
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	const [chooser] = await Promise.all([page.waitForEvent('filechooser'), manager.getByRole('button', { name: 'Import macro', exact: true }).click()]);
	await chooser.setFiles({ name: 'Normalize microphones.txt', mimeType: 'text/plain', buffer: Buffer.from('Normalize:ApplyVolume="1" PeakLevel="-1" RemoveDcOffset="1" StereoIndependent="0"\n') });
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager.getByRole('button', { name: 'Run macro', exact: true })).toBeEnabled({ timeout: 30000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'processing', { timeout: 30000 });
	await manager.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.locator('[data-track-row]').last().getByRole('button', { name: 'Solo', exact: true }).click();
	const pcm = await exportSamples(page, editor, { includeTail: false });
	const peak = pcm.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
	expect(peak).toBeCloseTo(10 ** (-1 / 20), 3);
});
