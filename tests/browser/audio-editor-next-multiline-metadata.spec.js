/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const tab of ['General', 'ID3']) test(`${tab} metadata edits preserve imported multiline custom text`, async ({ page }) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	let archive;
	try {
		archive = (await exportScapeProject(createSoundscaperProject({ id: 'multiline-metadata-file',
			metadata: { tags: { 'X-NOTES': 'First line\nSecond line' } } }), store)).blob;
	} finally { await store.close(); }
	let editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Notes.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'multiline-metadata-file');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	let panel = editor.locator('[data-metadata-editor]');
	await panel.getByRole('tab', { name: tab, exact: true }).click();
	let field = panel.getByRole('textbox', { name: 'X-NOTES', exact: true });
	await expect(field).toHaveValue('First line\nSecond line');
	await field.focus(); await field.press('Control+End'); await field.pressSequentially('!'); await field.press('Tab');
	await expect(field).toHaveValue('First line\nSecond line!');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(field).toHaveValue('First line\nSecond line');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(field).toHaveValue('First line\nSecond line!');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload(); editor = await waitForEditor(page); await waitForProjectActivation(editor);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	panel = editor.locator('[data-metadata-editor]'); await panel.getByRole('tab', { name: tab, exact: true }).click();
	field = panel.getByRole('textbox', { name: 'X-NOTES', exact: true });
	await expect(field).toHaveValue('First line\nSecond line!');
});
