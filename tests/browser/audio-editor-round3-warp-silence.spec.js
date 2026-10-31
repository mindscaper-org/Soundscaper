/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { showClipTimingFields, bootEditor, chooseNestedCommandAction, clipByName, clipField, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('Split clips at silences removes the pause at its authored warped timeline position', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	const recording = createWavFixture({ name: 'recording-with-pause.wav', frequency: 440, duration: 1, channelCount: 1 });
	// A normal mono recording with a quarter-second pause, retaining a standard PCM WAV header.
	recording.buffer.fill(0, 44 + 12_000 * 2, 44 + 24_000 * 2);
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await warp.getByLabel('Outer position', { exact: true }).fill('24000');
	await warp.getByLabel('Source sample', { exact: true }).fill('36000');
	await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
	await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('36000/1');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split clips at silences']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name).first());
	await showClipTimingFields(properties);
	const clipId = await properties.locator('[data-clip-properties-active-clip]').getAttribute('data-clip-properties-active-clip');
	await expect.poll(async () => (await persistedProject(page, projectId))?.clips.find(clip => clip.id === clipId)?.durationFrames).toBe(8_000);
	expect((await persistedProject(page, projectId)).sampleRate).toBe(48_000);
	const duration = clipField(properties, 'durationFrame');
	await duration.focus();
	await expect(duration).toHaveValue(String(8_000 / 48_000));
});
