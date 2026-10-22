/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('spreadsheet source references keep a POSIX filename with a literal backslash', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Template.wav', duration: 0.1 })]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
	const cell = grid.locator('[data-row="0"][data-column="source"]');
	const original = await cell.textContent();
	await cell.dblclick();
	const field = grid.getByRole('textbox', { name: 'Source file', exact: true });
	await field.fill('file:///recordings/Take%5Cone.wav');
	await field.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Clip spreadsheet', exact: true });
	const choosing = page.waitForEvent('filechooser');
	await dialog.getByRole('button', { name: 'Load referenced files', exact: true }).click();
	await (await choosing).setFiles(createWavFixture({ name: 'Take\\one.wav', duration: 0.1, frequency: 550 }));
	await expect(dialog).toHaveCount(0);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
	const source = project.sources.find(candidate => candidate.id === project.clips[0].sourceId);
	expect(source.name).toBe('Take\\one.wav');
	expect(source.frameCount).toBe(4_800);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(cell).toHaveText(original);
});
