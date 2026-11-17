/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, clipByName, closeClipProperties, closeDialog, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('Normalize retains the selected clip Auto Duck detector', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await importFiles(editor, [toneA, toneB]);
	const clip = clipByName(editor, toneA.name);
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, properties, 'track', 'Auto Duck');
	await closeDialog(page.getByRole('dialog', { name: 'Auto Duck', exact: true }));
	await closeClipProperties(properties);
	const id = await editor.getAttribute('data-project-id'), clipId = await clip.getAttribute('data-clip-id');
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Normalize to −1 dBFS', exact: true }).click();
	await expect.poll(async () => (await persistedProject(page, id))?.clips.find(value => value.id === clipId)?.gain).toBeGreaterThan(1);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
