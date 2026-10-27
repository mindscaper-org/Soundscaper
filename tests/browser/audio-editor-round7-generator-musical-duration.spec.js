/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { showClipTimingFields, bootEditor, chooseCommandAction, clipField, closeWorkspacePanel, collectClientErrors,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('one generated bar follows the tempo at its ordinary insertion playhead', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/en/');
	const projectId = await editor.getAttribute('data-project-id');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await importFiles(editor, [createWavFixture({ name: 'musical-duration.wav', duration: 8, frequency: 440 })]);
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await tempo.fill('60');
	await tempo.press('Enter');
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	const musical = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	await musical.getByRole('button', { name: 'Add tempo event', exact: true }).click();
	const second = musical.getByRole('form', { name: 'Tempo event 2', exact: true });
	await expect(second.locator('[name="beatNum"]')).toHaveValue('4');
	await second.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true }).fill('120');
	await second.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(second.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true })).toHaveValue('120');
	await page.keyboard.press('Escape');
	await expect.poll(async () => (await persistedProject(page, projectId))?.tempoMap.events.map(({ beat, bpm }) => ({ beat, bpm })))
		.toEqual([{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
			{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } }]);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const generateBar = async () => {
		await chooseCommandAction(page, editor, 'Generate', 'Tone');
		const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
		const duration = tone.locator('[data-generator-field="durationSeconds"]');
		await duration.getByRole('button', { name: 'Duration (seconds): format', exact: true }).click();
		await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
		await duration.locator('.timecode-digit').first().click();
		await page.keyboard.type('0011');
		await page.keyboard.press('Enter');
		await expect(duration.locator('.timecode-digit')).toHaveText(['0', '0', '1', '1']);
		await tone.getByRole('button', { name: 'Generate', exact: true }).click();
		await expect(tone).toBeHidden();
		const properties = await openClipProperties(page, editor);
		await showClipTimingFields(properties);
		return properties;
	};
	let properties = await generateBar();
	await expect(clipField(properties, 'durationFrame')).toHaveValue('4');
	let clipId = await properties.locator('[data-clip-properties-active-clip]').getAttribute('data-clip-properties-active-clip');
	await expect.poll(async () => {
		const saved = await persistedProject(page, projectId), clip = saved?.clips.find(clip => clip.id === clipId);
		return { sampleRate: saved?.sampleRate, start: clip?.timelineStartFrame, duration: clip?.durationFrames,
			sourceFrames: saved?.sources.find(source => source.id === clip?.sourceId)?.frameCount };
	}).toEqual({ sampleRate: 48_000, start: 0, duration: 192_000, sourceFrames: 192_000 });
	await closeWorkspacePanel(editor, 'clip-properties');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const playhead = editor.locator('[data-editor-tool-toolbar] [data-time-display]');
	await playhead.locator('.timecode-digit').nth(5).click();
	await page.keyboard.press('4');
	await page.keyboard.press('Enter');
	await expect(playhead.locator('.timecode-digit')).toHaveText(['0', '0', '0', '0', '0', '4', '0', '0']);
	properties = await generateBar();
	await expect(clipField(properties, 'durationFrame')).toHaveValue('2');
	clipId = await properties.locator('[data-clip-properties-active-clip]').getAttribute('data-clip-properties-active-clip');
	await expect.poll(async () => {
		const saved = await persistedProject(page, projectId), clip = saved?.clips.find(clip => clip.id === clipId);
		return { sampleRate: saved?.sampleRate, start: clip?.timelineStartFrame, duration: clip?.durationFrames,
			sourceFrames: saved?.sources.find(source => source.id === clip?.sourceId)?.frameCount };
	}).toEqual({ sampleRate: 48_000, start: 192_000, duration: 96_000, sourceFrames: 96_000 });
	expect(errors).toEqual([]);
});
