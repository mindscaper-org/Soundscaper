/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { localeCopy } from './helpers/locale-copy.js';
const GERMAN_COPY = localeCopy('de');
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('German native collision Copy gives the saved copy a German generated title', async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` }); let blob;
	try { blob = (await exportScapeProject(createSoundscaperProject({ id: 'localized-native-copy', title: 'Recording' }), store)).blob; }
	finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/de/');
	const file = { name: 'Recording.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) };
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', 'localized-native-copy'); await waitForProjectActivation(editor);
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	const collision = page.getByRole('dialog', { name: GERMAN_COPY.scapeCollisionTitle, exact: true });
	await collision.getByRole('button', { name: GERMAN_COPY.scapeOpenAsCopy, exact: true }).click();
	await expect(editor).not.toHaveAttribute('data-project-id', 'localized-native-copy'); await waitForProjectActivation(editor);
	await expect(editor.getByRole('tab', { name: 'Recording Kopie', exact: true })).toBeVisible();
	const id = await editor.getAttribute('data-project-id');
	await expect.poll(async () => (await persistedProject(page, id))?.title).toBe('Recording Kopie');
});
