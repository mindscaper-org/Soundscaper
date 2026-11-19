/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, closeWorkspacePanel, commitInput, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a saved camera project can be inserted as an audio subproject', async ({ page }) => {
	test.setTimeout(90000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createDeterministicAvFixture('child-camera.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await closeWorkspacePanel(editor, 'video-preview');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	let dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(dialog.getByRole('textbox', { name: 'Project name', exact: true }), 'Camera scene');
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseFileAction(page, editor, 'New');
	await waitForProjectActivation(editor);
	await chooseFileAction(page, editor, 'Subprojects');
	dialog = page.getByRole('dialog', { name: 'Subprojects', exact: true });
	await dialog.getByRole('combobox', { name: 'Project to insert or relink', exact: true }).selectOption({ label: 'Camera scene' });
	await dialog.getByRole('button', { name: 'Insert subproject', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Camera scene — Automatic updates', exact: true })).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const pcm = await exportSamples(page, editor);
	expect(pcm.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)).toBeGreaterThan(.01);
});
