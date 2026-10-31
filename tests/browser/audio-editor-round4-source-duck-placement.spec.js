/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { showClipTimingFields, bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName, clipField,
	closeClipProperties, commitInput, disableNativeSavePicker, importFiles, openClipProperties, openSourceMonitor } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('Auto Duck in a clip source uses its control track at the clip timeline placement', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	const files = ['music', 'voice'].map((name, index) => createWavFixture({
		name: `${name}.wav`, frequency: index ? 1000 : 330, duration: 2,
		channelCount: 1, channelAmplitudes: [0.35],
	}));
	await importFiles(editor, files);
	for (const recording of files) {
		const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
		await showClipTimingFields(properties);
		const start = clipField(properties, 'startFrame');
		await commitInput(start, '1');
		await expect(start).toHaveValue('1');
		const clipId = await properties.locator('[data-clip-properties-active-clip]').getAttribute('data-clip-properties-active-clip');
		await expect.poll(async () => (await persistedProject(page, projectId))?.clips.find(clip => clip.id === clipId)?.timelineStartFrame).toBe(48_000);
		await closeClipProperties(properties);
	}
	const voice = clipByName(editor, 'voice.wav');
	await voice.locator('xpath=ancestor::div[@data-track-row]').getByRole('button', { name: 'Mute', exact: true }).click();
	const music = clipByName(editor, 'music.wav');
	const properties = await openSourceMonitor(page, editor, music);
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Auto Duck']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await chooseDropdown(page, effect.getByRole('group', { name: 'Control track', exact: true }), 'voice');
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 20_000 });
	await closeClipProperties(properties);
	const output = await exportSamples(page, editor);
	// Measure after the effect's default 500 ms fade-down has completed.
	const firstPhrase = output.slice(81_600, 86_400);
	const peak = firstPhrase.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
	expect(peak).toBeGreaterThan(0.04);
	expect(peak).toBeLessThan(0.08);
});
