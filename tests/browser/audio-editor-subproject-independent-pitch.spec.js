/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, clipByName, closeClipProperties, commitInput, disableNativeSavePicker, importFiles, openClipProperties, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('inserting a cold saved subproject retains independent clip pitch', async ({ page }) => {
	test.setTimeout(90000);
	await disableNativeSavePicker(page);
	let editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const tone = createWavFixture({ name: 'Pitch.wav', frequency: 500, duration: 2, channelCount: 1 });
	await importFiles(editor, [tone]);
	const properties = await openClipProperties(page, editor, clipByName(editor, tone.name), { additional: false });
	const pitch = properties.getByRole('textbox', { name: 'Pitch', exact: true });
	await pitch.fill('12'); await pitch.press('Enter'); await expect(pitch).toHaveValue('12');
	await closeClipProperties(properties);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	let dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(dialog.getByRole('textbox', { name: 'Project name', exact: true }), 'Pitched scene');
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseFileAction(page, editor, 'New'); await waitForProjectActivation(editor);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload(); editor = await waitForEditor(page); await waitForProjectActivation(editor);
	await chooseFileAction(page, editor, 'Subprojects');
	dialog = page.getByRole('dialog', { name: 'Subprojects', exact: true });
	await dialog.getByRole('combobox', { name: 'Project to insert or relink', exact: true }).selectOption({ label: 'Pitched scene' });
	await dialog.getByRole('button', { name: 'Insert subproject', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Pitched scene — Automatic updates', exact: true })).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	const pcm = await exportSamples(page, editor);
	const sampleRate = 48000, from = 24000, to = 48000;
	let crossings = 0;
	for (let frame = from + 1; frame < to; frame++) if (pcm[frame - 1] <= 0 && pcm[frame] > 0) crossings++;
	expect(crossings * sampleRate / (to - from)).toBeCloseTo(1000, -1);
});
