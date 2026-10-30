/* SPDX-License-Identifier: AGPL-3.0-only */
import { TRACK_AUTOMATION_COPY_BY_LOCALE } from '../../src/common/i18n/editor-track-automation-copy.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, chooseCommandAction, clipByName } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { routeRippleProject } from '../helpers/next-route-ripple-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

const MASTER_ASSIGNMENT = TRACK_AUTOMATION_COPY_BY_LOCALE.en.automationAssignmentTarget.replace('{destination}', 'Master');

test('per-track gap closure keeps its output automation with the edited recording', async ({ page }) => {
	const { project, source } = routeRippleProject();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` });
	let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(source.frameCount).fill(.25)]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Route automation.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	const row = editor.locator('[data-track-row][data-track-id="voice"]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	await row.getByRole('combobox', { name: 'Automation parameter', exact: true }).selectOption({ label: MASTER_ASSIGNMENT });
	await expect(row.locator('[data-automation-point-id="voice-later"]')).toHaveCount(1);
	await clipByName(editor, 'First').locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete and close gap per track']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect.poll(async () => (await persistedProject(page, project.id))?.automationLanes.find(lane => lane.id === 'voice-output')?.points.find(point => point.id === 'voice-later')?.position).toBe(144_000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(editor).toHaveAttribute('data-clip-count', '3');
});
