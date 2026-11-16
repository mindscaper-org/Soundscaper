/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, closeDialog, collectClientErrors, importFiles,
	openAnalysisPanel, openEffectsForTrack, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

async function expectLabel(surface, text) {
	const label = surface.getByText(text, { exact: true }).first();
	await expect(label).toBeVisible();
	await expect(label).toHaveCSS('font-weight', '600');
	await expect(label).toHaveCSS('text-transform', 'none');
	await expect(label).toHaveCSS('letter-spacing', 'normal');
}

test.describe('Shared control labels', () => {
	registerAudioEditorHooks();

	test('effects, EQ, metadata and analysis use sentence case and semibold labels', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await importFiles(editor, [createWavFixture({ name: 'control-labels.wav', duration: 2 })]);
		const effects = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, effects, 'track', 'Hum removal');
		let dialog = page.getByRole('dialog', { name: 'Hum removal', exact: true });
		for (const label of ['Fundamental frequency', 'Harmonics', 'Notch width', 'Reduction']) await expectLabel(dialog, label);
		await expect(dialog.getByRole('button', { name: 'Help: Fundamental frequency', exact: true })).toBeVisible();
		await closeDialog(dialog);
		await expectLabel(effects, 'Master gain');

		await addRackEffect(page, effects, 'track', 'Vocoder');
		dialog = page.getByRole('dialog', { name: 'Vocoder', exact: true });
		for (const label of ['Distance', 'Output', 'Vocoder bands', 'Audio carrier level', 'Radar pulse frequency']) await expectLabel(dialog, label);
		await closeDialog(dialog);

		await addRackEffect(page, effects, 'track', 'Bass and Treble');
		dialog = page.getByRole('dialog', { name: 'Bass and Treble', exact: true });
		await expectLabel(dialog, 'Auto-adjust volume to preserve loudness');
		await dialog.getByRole('checkbox', { name: 'Auto-adjust volume to preserve loudness', exact: true }).click();
		await expect(dialog.getByRole('checkbox', { name: 'Auto-adjust volume to preserve loudness', exact: true })).toBeChecked();
		await closeDialog(dialog);

		await addRackEffect(page, effects, 'track', 'Parametric EQ');
		dialog = page.getByRole('dialog', { name: 'Parametric EQ', exact: true });
		for (const label of ['Type', 'Frequency (Hz)', 'Gain (dB)', 'Q', 'Output gain (dB)', 'Input spectrum', 'Band enabled']) await expectLabel(dialog, label);
		await dialog.getByRole('spinbutton', { name: 'Frequency (Hz)', exact: true }).fill('440');
		await dialog.getByRole('spinbutton', { name: 'Frequency (Hz)', exact: true }).press('Tab');
		await expect(dialog.getByRole('spinbutton', { name: 'Frequency (Hz)', exact: true })).toHaveValue('440');
		await closeDialog(dialog);

		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const metadata = editor.locator('[data-metadata-editor]');
		for (const label of ['Title', 'Artist', 'Track number']) await expectLabel(metadata, label);
		const analysis = await openAnalysisPanel(page, editor);
		for (const label of ['Peak', 'RMS', 'Clipping']) await expectLabel(analysis, label);
		expect(errors).toEqual([]);
	});
});
