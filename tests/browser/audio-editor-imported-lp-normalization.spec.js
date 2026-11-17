/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('an imported Audacity normalization macro runs above the whole-selection memory cap', async ({ page }) => {
	test.setTimeout(120_000);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const audio = createWavFixture({ name: 'LP.wav', frequency: 440, duration: 180, sampleRate: 48_000, channelCount: 2 });
	await importFiles(editor, [audio]);
	const clipCount = await editor.getAttribute('data-clip-count');
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	const chooser = page.waitForEvent('filechooser');
	await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await chooser).setFiles({ name: 'LP normalization.txt', mimeType: 'text/plain', buffer: Buffer.from(
		'SelectAll:\nNormalize:ApplyVolume="1" PeakLevel="0" RemoveDcOffset="1" StereoIndependent="0"\nSelectAll:\nLoudnessNormalization:DualMono="1" LUFSLevel="-16" NormalizeTo="0" RMSLevel="-1" StereoIndependent="1"') });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('LP normalization');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(editor.locator('[data-status]')).toHaveText('Macro applied.', { timeout: 90_000 });
	await expect(manager.getByRole('button', { name: 'Run macro', exact: true })).toBeEnabled();
	await expect(manager.getByRole('alert')).toHaveCount(0);
	await closeDialog(manager);
	await expect(editor).toHaveAttribute('data-clip-count', clipCount);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', clipCount);
	expect(errors).toEqual([]);
});
