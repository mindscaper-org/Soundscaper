/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { showClipTimingFields, bootEditor, chooseNestedCommandAction, clipField, openClipProperties } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('Rhythm Track retains all sixteen bars at thirty beats per minute', async ({ page }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Rhythm Track']);
	const dialog = page.getByRole('dialog', { name: 'Rhythm Track', exact: true });
	await dialog.getByRole('spinbutton', { name: /^Tempo \(bpm\)/u }).fill('30');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 60_000 });
	const clip = editor.locator('[data-clip-id]').first();
	await expect(clip).toBeVisible();
	const properties = await openClipProperties(page, editor, clip);
	await showClipTimingFields(properties);
	await expect(clipField(properties, 'durationFrame')).toHaveValue('128');
	const clipId = await properties.locator('[data-clip-properties-active-clip]').getAttribute('data-clip-properties-active-clip');
	await expect.poll(async () => (await persistedProject(page, projectId))?.clips.find(clip => clip.id === clipId)?.durationFrames).toBe(6_144_000);
});
