/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction, clipByName,
	collectClientErrors, commitInput, disableNativeSavePicker, effectSourceMetadata, importFiles,
	openExportDialog, readDownloadBytes, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { readWavePcm } from '../helpers/read-wave-pcm.ts';

function stereoOffsetFixture() {
	const fixture = createWavFixture({ name: 'stereo timing error.wav', frequency: 440, duration: 3 });
	let seed = 37;
	const samples = Array.from({ length: 144000 }, () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
		return Math.round(seed / 2 ** 32 * 24000);
	});
	for (let frame = 0; frame < samples.length; frame++) {
		fixture.buffer.writeInt16LE(samples[frame], 44 + frame * 4);
		fixture.buffer.writeInt16LE(Math.round((samples[frame - 12] ?? 0) / 2), 46 + frame * 4);
	}
	return fixture;
}

test.describe('Automatic phase correction', () => {
	registerAudioEditorHooks();

	test('analyzes stereo, auditions original/corrected and mono, applies, and supports undo/redo', async ({ page }) => {
		const errors = collectClientErrors(page);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		const audio = stereoOffsetFixture();
		await importFiles(editor, [audio]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Automatic phase correction']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Reference channel', exact: true }), 'Right');
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Reference channel', exact: true }), 'Left');
		await commitInput(dialog.getByRole('spinbutton', { name: 'Maximum correction (ms)', exact: true }), '2');
		await commitInput(dialog.getByRole('spinbutton', { name: 'Minimum confidence (%)', exact: true }), '90');
		await dialog.getByRole('button', { name: 'Analyze', exact: true }).click();
		const report = dialog.getByRole('status', { name: 'Phase analysis results', exact: true });
		await expect(report).toContainText('Right channel lags by 12 samples (0.25 ms)');
		await expect(dialog.getByRole('button', { name: 'Stop preview', exact: true })).toHaveCount(0);
		expect(await effectSourceMetadata(page)).toEqual([]);
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Preview source', exact: true }), 'Original');
		await dialog.getByRole('checkbox', { name: 'Listen in mono', exact: true }).check();
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Stop preview', exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click();
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Preview source', exact: true }), 'Corrected');
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Stop preview', exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click();
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect.poll(async () => (await effectSourceMetadata(page))
			.find(source => source.name.includes('Automatic phase correction'))?.frameCount).toBe(144000);
		const exportDialog = await openExportDialog(page, editor);
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible();
		const wave = readWavePcm(await readDownloadBytes(page, download));
		expect(wave.channels).toHaveLength(2);
		let error = 0, energy = 0, rightEnergy = 0;
		for (let frame = 256; frame < wave.channels[0].length - 256; frame++) {
			const left = wave.channels[0][frame], right = wave.channels[1][frame];
			error += (right - left / 2) ** 2;
			energy += left ** 2;
			rightEnergy += right ** 2;
		}
		expect(Math.sqrt(error / energy)).toBeLessThan(.001);
		expect(Math.sqrt(rightEnergy / energy)).toBeCloseTo(.5, 3);
		await exportDialog.getByRole('button', { name: 'Close', exact: true }).click();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, audio.name)).toHaveCount(1);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		expect(errors).toEqual([]);
	});

	test('mono input is refused without publishing a replacement', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		const audio = createWavFixture({ name: 'mono voice.wav', frequency: 440, duration: 1, channelCount: 1 });
		await importFiles(editor, [audio]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Automatic phase correction']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await dialog.getByRole('button', { name: 'Analyze', exact: true }).click();
		await expect(dialog.getByRole('alert')).toContainText('requires stereo audio');
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog.getByRole('alert')).toContainText('requires stereo audio');
		expect(await effectSourceMetadata(page)).toEqual([]);
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(clipByName(editor, audio.name)).toHaveCount(1);
	});
});
