/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { masteringRegionProject } from '../helpers/next-mastering-region-project.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { strFromU8, unzipSync } from 'fflate';

test('an imported secondary mastering order adds its own regions', async ({ page }) => {
	await disableNativeSavePicker(page); const project = masteringRegionProject();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false }); let blob;
	try { blob = (await exportScapeProject(project, store)).blob; } finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Secondary order.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	await chooseCommandAction(page, editor, 'Tools', 'Mastering sequences');
	const dialog = page.getByRole('dialog', { name: 'Mastering sequences', exact: true });
	const order = dialog.getByRole('combobox', { name: 'Sequence', exact: true });
	await order.selectOption('cut-order');
	const regions = dialog.getByRole('combobox', { name: 'Add region', exact: true });
	await expect(regions.locator('option')).toHaveText(['Cut opening', 'Cut reprise']);
	await regions.selectOption('cut-b');
	await dialog.getByRole('button', { name: 'Add region', exact: true }).click();
	await expect(dialog.locator('[data-mastering-entry]')).toHaveCount(2);
	await expect(dialog.getByText('This sequence cannot be delivered', { exact: true })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const files = unzipSync(await downloadBytes(await downloading));
	const saved = JSON.parse(strFromU8(files['project.json']));
	expect(saved.masteringSequences.find(sequence => sequence.id === 'cut-order').entries.map(entry => entry.annotationId)).toEqual(['cut-a', 'cut-b']);
});
