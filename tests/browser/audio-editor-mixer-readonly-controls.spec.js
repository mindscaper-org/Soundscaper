/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, closeDialog, closeEffectsPanel, importFiles,
	openEffectsForTrack, resolveBrowserProductTestUrl, waitForEditor } from './audio-editor-test-helpers.js';

test('a project locked by another tab disables Mixer strip edits while listening volume stays available', async ({ page, context }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'read-only-mix.wav', frequency: 440, duration: 0.5, channelCount: 2 })]);
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Reverb');
	await closeDialog(page.getByRole('dialog', { name: 'Reverb', exact: true }));
	await closeEffectsPanel(effects);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const other = await context.newPage();
	try {
		await other.goto(resolveBrowserProductTestUrl('/embed/en/'));
		await expect(await waitForEditor(other)).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await page.bringToFront();
		const mixer = editor.locator('[data-workspace-panel="mixer"]');
		await expect(mixer.getByRole('slider', { name: 'read-only-mix volume', exact: true })).toBeDisabled();
		for (const slider of await mixer.getByRole('slider').all()) await expect(slider).toBeDisabled();
		for (const label of ['Mute', 'Solo', 'Disable effect', 'Select effect']) {
			for (const button of await mixer.getByRole('button', { name: label, exact: true, includeHidden: true }).all()) await expect(button).toBeDisabled();
		}
		await expect(mixer.getByRole('button', { name: 'Reverb', exact: true })).toBeEnabled();
		await expect(editor.getByRole('slider', { name: 'Playback volume', exact: true })).toBeEnabled();
		await expect(editor.locator('[data-editor-toast="workspace-error"]')).toHaveCount(0);
	} finally { await other.close(); }
});
