/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, monoTone as toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties, closeDialog, closeEffectsPanel, importFiles, openClipProperties, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('Freeze refuses a mono clip stereo reverb before replacing its audible image', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const trackEffects = await openEffectsForTrack(editor, await editor.locator('[data-track-row]').count() - 1);
	await addRackEffect(page, trackEffects, 'track', 'Feedback delay');
	await closeDialog(page.getByRole('dialog', { name: 'Feedback delay', exact: true }));
	await closeEffectsPanel(trackEffects);
	const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await panel.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, panel, 'track', 'Reverb');
	await closeDialog(page.getByRole('dialog', { name: 'Reverb', exact: true }));
	await closeClipProperties(panel);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const before = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(before.sources.find(source => source.id === before.clips[0].sourceId).channelCount).toBe(1);
	expect(before.clips[0].effects[0].type).toBe('reverb');
	expect(before.clips[0].effectsActive).not.toBe(false);
	expect(before.clips[0].effects[0].enabled).toBe(true);
	expect(before.clips[0].effects[0].params.mix).toBeGreaterThan(0);
	await clipByName(editor, toneA.name).getByText(toneA.name, { exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Freeze track']);
	await expect(page.getByRole('alert')).toContainText('channel widths');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(project.tracks.every(track => !track.audioFreeze)).toBe(true);
	expect(project.clips[0].effects[0].type).toBe('reverb');
});
