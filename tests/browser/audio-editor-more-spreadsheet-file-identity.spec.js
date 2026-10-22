/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('the spreadsheet uses the selected filename when an unpadded namesake is also imported', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ ...toneA, name: 'take.wav' }, { ...toneB, name: ' take.wav ' }]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
	const intended = project.sources.find(source => source.name === ' take.wav ');
	expect(intended).toBeTruthy();
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
	const source = grid.locator('[data-row="0"][data-column="source"]');
	await source.dblclick();
	const input = grid.getByRole('textbox', { name: 'Source file', exact: true });
	await input.fill(' take.wav ');
	await input.press('Enter');
	await expect(source).toHaveText(intended.id);
});
