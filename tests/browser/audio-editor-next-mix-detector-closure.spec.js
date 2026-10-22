/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { mixDetectorProject } from '../helpers/next-mix-detector-project.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

const peak = samples => Math.max(...samples.slice(9_600, 28_800).map(Math.abs));
for (const kind of ['track', 'bus']) for (const mixDown of [true, false]) test(`${mixDown ? 'Combined' : 'Individual'} Mix & Render prints its external ${kind} Gate detector`, async ({ page }) => {
	const { project, sources, channels } = mixDetectorProject(kind);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false }); let blob;
	try {
		for (const source of sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write(channels.get(source.id)); await writer.commit();
		}
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Detector.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	const before = await exportSamples(page, editor); expect(peak(before)).toBeLessThan(.0001);
	await editor.locator('[data-clip-id="voice-clip"] .clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Mix & Render']);
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	if (!mixDown) await dialog.getByRole('checkbox', { name: 'Mix down', exact: true }).click();
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click(); await expect(dialog).toBeHidden();
	const after = await exportSamples(page, editor); expect(peak(after)).toBeLessThan(.0001);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const undone = await exportSamples(page, editor); expect(peak(undone)).toBeLessThan(.0001);
});
