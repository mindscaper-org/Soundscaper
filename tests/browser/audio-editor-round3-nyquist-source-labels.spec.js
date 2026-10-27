/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { showClipTimingFields, bootEditor, chooseCommandAction, clipByName, clipField, commitInput, importFiles, openClipProperties, openSourceMonitor } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('Nyquist labels from a source selection retain its clip placement', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	await importFiles(editor, [toneA]);
	const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await showClipTimingFields(panel);
	const start = clipField(panel, 'startFrame');
	await commitInput(start, '1');
	await expect(start).toHaveValue('1');
	const clipId = await panel.locator('[data-clip-properties-active-clip]').getAttribute('data-clip-properties-active-clip');
	await expect.poll(async () => (await persistedProject(page, projectId))?.clips.find(clip => clip.id === clipId)?.timelineStartFrame).toBe(48_000);
	const sourceMonitor = await openSourceMonitor(page, editor);
	const waveform = sourceMonitor.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill("'((0.2 0.4 \"Analysis\"))");
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('label(s)', { timeout: 30_000 });
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const labels = editor.locator('[data-workspace-panel="labels"]');
	await expect(labels.locator('.timecode__display').first()).toHaveText('00h00m01.200s');
	await expect(labels.locator('.timecode__display').nth(1)).toHaveText('00h00m01.400s');
});
