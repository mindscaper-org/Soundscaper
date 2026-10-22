/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, chooseCommandAction, clipByName } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { overlapRippleProject } from '../helpers/next-overlap-ripple-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

for (const kind of ['takes', 'automation']) test(`overlapping clip ripple keeps ${kind} aligned with the remaining audio`, async ({ page }) => {
	const { project, source } = overlapRippleProject(kind);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` });
	let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(source.frameCount).fill(.25)]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Overlap ripple.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await expect(editor).not.toHaveAttribute('data-project-activation-pending', 'true');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await clipByName(editor, 'First').press('Enter');
	await expect(clipByName(editor, 'First').locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	// These headers overlap; use the supported additive keyboard selection.
	await clipByName(editor, 'Second').press('Shift+Enter');
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete and close gap per track']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect.poll(async () => (await persistedProject(page, project.id))?.clips[0]?.timelineStartFrame).toBe(72_000);
	if (kind === 'takes') await expect.poll(async () => (await persistedProject(page, project.id))?.takeGroups[0]?.startSample).toBe(72_000);
	else await expect.poll(async () => (await persistedProject(page, project.id))?.automationLanes[0]?.points.find(point => point.id === 'later-gain')?.position).toBe(72_000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '3');
});
