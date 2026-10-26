/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, closeWorkspacePanel, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';

test('the metadata UI authors and persists the custom credit supplied to desktop MCP', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-metadata-editor]');
	await panel.getByRole('tab', { name: 'ID3', exact: true }).click();
	await panel.getByRole('textbox', { name: 'Field name', exact: true }).fill('__proto__');
	await panel.getByRole('textbox', { name: 'Field value', exact: true }).fill('Microphone body, contact channel');
	await panel.getByRole('button', { name: 'Add field', exact: true }).click();
	await expect(panel.getByRole('textbox', { name: '__proto__', exact: true })).toHaveValue('Microphone body, contact channel');
	await expect(panel.getByRole('alert')).toHaveCount(0);
	await closeWorkspacePanel(editor, 'metadata');
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading));
	const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.metadata.tags).toHaveProperty('__proto__', 'Microphone body, contact channel');
	expect(Object.hasOwn(project.metadata.tags, '__proto__')).toBe(true);
	expect(project.clips).toHaveLength(1);
});
