/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { showClipTimingFields, bootEditor, chooseCommandAction, clipField, openClipProperties } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('DTMF delivers the exact total duration entered in its dialog', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
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
	await expect(clipField(properties, 'durationFrame')).toHaveValue('1');
	const clipId = await properties.locator('[data-clip-properties-active-clip]').getAttribute('data-clip-properties-active-clip');
	await expect.poll(async () => {
		const saved = await persistedProject(page, projectId), clip = saved?.clips.find(clip => clip.id === clipId);
		return { sampleRate: saved?.sampleRate, kind: clip?.kind, duration: clip?.durationFrames,
			sourceFrames: saved?.sources.find(source => source.id === clip?.sourceId)?.frameCount };
	}).toEqual({ sampleRate: 48_000, kind: 'audio', duration: 48_000, sourceFrames: 48_000 });
});
