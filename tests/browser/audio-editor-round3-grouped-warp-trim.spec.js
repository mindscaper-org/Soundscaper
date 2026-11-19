/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, clipField, importFiles, openClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('a grouped keyboard trim resolves an editable boundary on every participating recording', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	const plain = createWavFixture({ name: 'plain-recording.wav', frequency: 440, duration: 1, channelCount: 1 });
	const warped = createWavFixture({ name: 'aligned-recording.wav', frequency: 440, duration: 1, channelCount: 1 });
	await importFiles(editor, [plain, warped]);
	await clipByName(editor, warped.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await warp.getByLabel('Outer position', { exact: true }).fill('43201');
	await warp.getByLabel('Source sample', { exact: true }).fill('43200');
	await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
	await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('43200/1');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	await clipByName(editor, plain.name).locator('.clip-header').click({ modifiers: ['Shift'] });
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Group clips']);
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const clip = clipByName(editor, plain.name);
	await clip.focus();
	await expect(clip).toBeFocused();
	await clip.getByRole('button', { name: 'Trim right edge', exact: true }).press('ArrowLeft');
	await expect(editor.locator('[data-editor-toast="workspace-error"]')).toBeHidden();
	// Group selection uses the merged inspector; ungroup after the edit to inspect both native boundaries.
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Ungroup clips']);
	for (const fixture of [plain, warped]) {
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		const properties = await openClipProperties(page, editor, clipByName(editor, fixture.name));
		await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(1);
		await showClipTimingFields(properties);
		const clipId = await properties.locator('[data-clip-properties-active-clip]').getAttribute('data-clip-properties-active-clip');
		await expect.poll(async () => (await persistedProject(page, projectId))?.clips.find(clip => clip.id === clipId)?.durationFrames).toBe(43_201);
		expect((await persistedProject(page, projectId)).sampleRate).toBe(48_000);
		const duration = clipField(properties, 'durationFrame');
		await duration.focus();
		await expect(duration).toHaveValue(String(43_201 / 48_000));
	}
});
