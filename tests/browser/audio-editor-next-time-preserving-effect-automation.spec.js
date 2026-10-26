/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, clipByName } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { effectAutomationProject } from '../helpers/next-time-preserving-effect-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

test('Invert on a time range retains the unbaked native gain automation in exported audio and Undo', async ({ page }) => {
	const { project, source, samples } = effectAutomationProject();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` }); let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([samples]); await writer.commit(); blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Automation.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	const before = await exportSamples(page, editor);
	await clipByName(editor, 'Recording').locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	await expect(editor.locator('[data-status]')).toHaveText(/applied/iu);
	const after = await exportSamples(page, editor);
	expect(after.length).toBe(before.length);
	const residual = after.slice(1_000, -1_000).reduce((peak, sample, index) => Math.max(peak, Math.abs(sample + before[index + 1_000])), 0);
	expect(residual).toBeLessThan(.0001);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); const undone = await exportSamples(page, editor);
	expect(undone.length).toBe(before.length);
	expect(undone.reduce((peak, sample, index) => Math.max(peak, Math.abs(sample - before[index])), 0)).toBeLessThan(.000001);
});
