/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { vcaPrintProject } from '../helpers/next-vca-print-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

for (const mute of [true, false]) test(`Mix and Render ignores a ${mute ? 'muted' : 'healthy'} VCA listening gate while preserving gain`, async ({ page }) => {
	const { project, source, samples } = vcaPrintProject(mute);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` }); let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([samples]); await writer.commit(); blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'VCA.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const before = await exportSamples(page, editor);
	expect(Math.abs(before[2_400])).toBeCloseTo(mute ? 0 : .1 * Math.SQRT1_2, 5);
	await chooseCommandAction(page, editor, 'Tracks', 'Mix & Render');
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	await expect(dialog).toBeHidden(); await expect(editor).toHaveAttribute('data-clip-count', '1');
	const after = await exportSamples(page, editor);
	expect(after[2_400]).toBeCloseTo(.1 * Math.SQRT1_2, 5);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const undone = await exportSamples(page, editor);
	expect(undone[2_400]).toBeCloseTo(before[2_400], 5);
});
