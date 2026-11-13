/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, longTone, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, clipByName, clipField, collectClientErrors, commitInput,
	chooseCommandAction, importFiles, openClipProperties, openSourceMonitor, registerAudioEditorHooks, waitForEditor, waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { chooseClipMediaSetting, chooseClipPitchUnit, expectClipMediaSettingChecked } from './audio-editor-clip-settings-test-helpers.js';

test.describe('clip properties pitch and normalization', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1440, height: 1000 } });

	test('linked controls follow sample playback rate and retain the independent pitch when unlinked', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await importFiles(editor, [longTone]);
		let panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));

		await commitInput(clipField(panel, 'pitchCents'), '3');
		await commitInput(clipField(panel, 'speedRatio'), '150');
		await chooseClipMediaSetting(panel, 'Link pitch and tempo');
		await expectClipMediaSettingChecked(panel, 'Link pitch and tempo', true);
		await expect(clipField(panel, 'pitchCents')).toHaveValue('7.02');
		await commitInput(clipField(panel, 'speedRatio'), '400');
		await expect(clipField(panel, 'pitchCents')).toHaveValue('24');
		await commitInput(clipField(panel, 'pitchCents'), '12');
		await expect(clipField(panel, 'speedRatio')).toHaveValue('200');
		await chooseClipPitchUnit(panel, 'Percent change');
		await expect(clipField(panel, 'pitchCents')).toHaveValue('100');
		await commitInput(clipField(panel, 'pitchCents'), '-50');
		await expect(clipField(panel, 'speedRatio')).toHaveValue('50');
		const source = await openSourceMonitor(page, editor);
		await source.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(source.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await source.getByRole('button', { name: 'Stop', exact: true }).click();
		await chooseClipMediaSetting(panel, 'Link pitch and tempo');
		await chooseClipPitchUnit(panel, 'Semitones (half-steps)');
		await expect(clipField(panel, 'pitchCents')).toHaveValue('3');
		await expect(clipField(panel, 'speedRatio')).toHaveValue('50');
		await expect(panel.getByRole('alert')).toHaveCount(0);
		const previousProjectId = await editor.getAttribute('data-project-id');
		await chooseCommandAction(page, editor, 'File', 'New');
		await expect(editor).not.toHaveAttribute('data-project-id', previousProjectId);
		await waitForProjectActivation(editor);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await importFiles(editor, [longTone]);
		panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));
		await test.step('neutral percent fields preserve the unchanged clip', async () => {
			await chooseClipPitchUnit(panel, 'Percent change');
			for (const [field, neutral] of [['pitchCents', '0'], ['speedRatio', '100']]) {
				await expect(clipField(panel, field)).toHaveValue(neutral);
			}
			await expect(clipByName(editor, longTone.name).getByRole('button', { name: 'Clip speed', exact: true })).toHaveCount(0);
			await chooseClipPitchUnit(panel, 'Semitones (half-steps)');
		});

		await test.step('neutral linked playback retains render admission and durable independent pitch', async () => {
			await commitInput(clipField(panel, 'pitchCents'), '3');
			await chooseClipMediaSetting(panel, 'Link pitch and tempo');
			await expect(clipField(panel, 'pitchCents')).toHaveValue('0');
			await expect(panel.locator('[data-clip-properties-action="render-pitch-speed"]')).toBeDisabled();
			await clipByName(editor, longTone.name).click({ button: 'right', position: { x: 32, y: 10 } });
			await expect(page.locator('.audio-editor-clip-context-menu')
				.getByRole('menuitem', { name: 'Render pitch and speed', exact: true })).toHaveAttribute('aria-disabled', 'true');
			await page.keyboard.press('Escape');
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			await page.reload();
			editor = await waitForEditor(page);
			panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));
			await expectClipMediaSettingChecked(panel, 'Link pitch and tempo', true);
			await expect(clipField(panel, 'pitchCents')).toHaveValue('0');
			await chooseClipMediaSetting(panel, 'Link pitch and tempo');
			await expect(clipField(panel, 'pitchCents')).toHaveValue('3');
		});

		expect(errors).toEqual([]);
	});

	test('clip speeds below one percent retain the native value through reload', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		const recording = createWavFixture({ name: 'slow-clip.wav', frequency: 220, duration: 0.02, channelCount: 1 });
		await importFiles(editor, [recording]);
		let panel = await openClipProperties(page, editor, clipByName(editor, recording.name));
		await chooseClipMediaSetting(panel, 'Link pitch and tempo');
		for (const percent of ['0.5', '0.1']) {
			await commitInput(clipField(panel, 'speedRatio'), percent);
			await expect(clipField(panel, 'speedRatio')).toHaveValue(percent);
		}
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openClipProperties(page, editor, clipByName(editor, recording.name));
		await expect(clipField(panel, 'speedRatio')).toHaveValue('0.1');
		expect(errors).toEqual([]);
	});

	test('Media settings keeps its gain dialog and normalization actions share a section', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await importFiles(editor, [longTone]);
		const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));
		await expect(panel.getByRole('textbox', { name: 'Clip gain (dB)', exact: true })).toHaveCount(0);
		await chooseClipMediaSetting(panel, 'Clip gain (dB)');
		let gainDialog = page.getByRole('dialog', { name: 'Clip gain (dB)', exact: true });
		await gainDialog.getByRole('textbox', { name: 'Clip gain (dB)', exact: true }).fill('-6');
		await gainDialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(gainDialog).toBeHidden();
		await chooseClipMediaSetting(panel, 'Clip gain (dB)');
		gainDialog = page.getByRole('dialog', { name: 'Clip gain (dB)', exact: true });
		await expect(gainDialog.getByRole('textbox', { name: 'Clip gain (dB)', exact: true })).toHaveValue('-6');
		await gainDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		const normalization = panel.locator('[data-group="normalize"]');
		const peak = await normalization.getByRole('button', { name: '−1 dBFS', exact: true }).boundingBox();
		const loudness = await normalization.getByRole('button', { name: '−14 LUFS', exact: true }).boundingBox();
		expect(peak).not.toBeNull(); expect(loudness).not.toBeNull();
		expect(loudness.y).toBeCloseTo(peak.y, 0);
		expect(loudness.x).toBeGreaterThanOrEqual(peak.x + peak.width);
	});
});
