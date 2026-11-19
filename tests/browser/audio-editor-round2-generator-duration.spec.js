/* SPDX-License-Identifier: AGPL-3.0-only */

import { expectClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { showClipTimingFields, bootEditor, chooseCommandAction, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

import { persistedProject } from './helpers/complex-editing-workflows.js';

test('DTMF delivers the exact total duration entered in its dialog', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const projectId = await editor.getAttribute('data-project-id');
	await chooseCommandAction(page, editor, 'Generate', 'DTMF tones');
	const generator = page.getByRole('dialog', { name: 'DTMF tones', exact: true });
	await generator.getByRole('textbox', { name: 'DTMF sequence', exact: true }).fill('1234567890');
	const duration = generator.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').first().click();
	await page.keyboard.type('000001000');
	await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode__display')).toHaveText('00h00m01.000s');
	await generator.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(generator).toBeHidden();
	const properties = await openClipProperties(page, editor);
	await showClipTimingFields(properties);
	await expectClipTimeFrames(properties, 'durationFrame', 48_000);
	const clipId = await properties.locator('[data-clip-properties-active-clip]').getAttribute('data-clip-properties-active-clip');
	await expect.poll(async () => {
		const saved = await persistedProject(page, projectId), clip = saved?.clips.find(clip => clip.id === clipId);
		return { sampleRate: saved?.sampleRate, kind: clip?.kind, duration: clip?.durationFrames,
			sourceFrames: saved?.sources.find(source => source.id === clip?.sourceId)?.frameCount };
	}).toEqual({ sampleRate: 48_000, kind: 'audio', duration: 48_000, sourceFrames: 48_000 });
});

test('DTMF shows the exact sample duration of a sub-millisecond selection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createWavFixture({ name: 'twelve-samples.wav', frequency: 440, duration: 12 / 48_000 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Generate', 'DTMF tones');
	const generator = page.getByRole('dialog', { name: 'DTMF tones', exact: true });
	await generator.getByRole('button', { name: 'Duration (seconds): format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	const duration = generator.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await expect(duration.locator('.timecode-digit').nth(-2)).toHaveText('1');
	await expect(duration.locator('.timecode-digit').last()).toHaveText('2');
	await generator.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(generator).toBeHidden();
	const properties = await openClipProperties(page, editor);
	await showClipTimingFields(properties);
	await expectClipTimeFrames(properties, 'durationFrame', 12);
});
