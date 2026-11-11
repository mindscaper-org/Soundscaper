/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction, clickClipInterior,
	clipByName, closeDialog, closeEffectsPanel, collectClientErrors, commitInput, disableNativeSavePicker,
	importFiles, openEffectsForTrack, openExportDialog, readDownloadBytes, registerAudioEditorHooks, waitForEditor,
} from './audio-editor-test-helpers.js';

const melody = { name: 'control-melody.mid', mimeType: 'audio/midi',
	buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000904764964080470000ff2f00', 'hex') };
const voice = () => createWavFixture({ name: 'voice.wav', frequency: 450, duration: 3, sampleRate: 48000 });

test.describe('Auto-Tune MIDI control track', () => {
	registerAudioEditorHooks();
	test('rack offers only MIDI tracks, restores its control track, and exports the controlled pitch with a muted MIDI instrument', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await importFiles(editor, [voice(), melody]);
		await clipByName(editor, 'MIDI 1').locator('xpath=ancestor::div[@data-track-row][1]')
			.getByRole('button', { name: 'Mute', exact: true }).click();
		let panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Auto-Tune');
		let settings = page.getByRole('dialog', { name: 'Auto-Tune', exact: true });
		const control = settings.getByRole('group', { name: 'Control track', exact: true });
		await control.getByRole('button').click();
		await expect(page.getByRole('option')).toHaveText(['None (use key and scale)', 'MIDI 1']);
		await page.getByRole('option', { name: 'MIDI 1', exact: true }).click();
		await expect(settings.getByRole('group', { name: 'Scale', exact: true }).getByRole('button')).toBeDisabled();
		await chooseDropdown(page, control, 'None (use key and scale)');
		await expect(settings.getByRole('group', { name: 'Scale', exact: true }).getByRole('button')).toBeEnabled();
		await chooseDropdown(page, control, 'MIDI 1');
		await commitInput(settings.getByRole('spinbutton', { name: 'Retune speed', exact: true }), '0');
		await closeDialog(settings);
		await closeEffectsPanel(panel);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openEffectsForTrack(editor, 1);
		await panel.locator('[data-effect-rack]').getByRole('group', { name: 'Auto-Tune', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		settings = page.getByRole('dialog', { name: 'Auto-Tune', exact: true });
		await expect(settings.getByRole('group', { name: 'Control track', exact: true }).getByRole('button')).toContainText('MIDI 1');
		await closeDialog(settings);
		await closeEffectsPanel(panel);
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = dialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20000 });
		const wav = new Blob([await readDownloadBytes(page, download)]);
		expect((await inspectWavBlobPcm(wav)).frameCount).toBe(144000);
		const samples = [];
		await streamWavBlobPcm(wav, { onChunk: channels => { samples.push(...channels[0]); } });
		const crossings = [];
		for (let frame = 24001; frame < 96000; frame++) if (samples[frame - 1] <= 0 && samples[frame] > 0) {
			crossings.push(frame - 1 - samples[frame - 1] / (samples[frame] - samples[frame - 1]));
		}
		const pitch = (crossings.length - 1) * 48000 / (crossings.at(-1) - crossings[0]);
		expect(Math.abs(pitch - 493.883)).toBeLessThan(1);
		expect(errors).toEqual([]);
	});

	test('selection exposes optional MIDI control, previews, applies and undoes', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await importFiles(editor, [voice(), melody]);
		await editor.getByRole('button', { name: 'Rename track: voice', exact: true }).click();
		await clickClipInterior(page, clipByName(editor, 'voice.wav'));
		await expect(clipByName(editor, 'voice.wav').locator('xpath=ancestor::div[@data-track-row][1]').locator('[data-track-header]')).toHaveAttribute('data-selected', 'true');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Distortion and modulation', 'Auto-Tune']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Control track', exact: true }), 'MIDI 1');
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Stop preview', exact: true })).toBeVisible({ timeout: 20000 });
		await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click();
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20000 });
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(clipByName(editor, 'voice.wav')).toHaveCount(1);
		expect(errors).toEqual([]);
	});
});
