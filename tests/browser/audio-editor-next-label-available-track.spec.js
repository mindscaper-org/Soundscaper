/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

for (const available of [true, false]) test(`Add label finds an editable destination; existing peer=${available}`, async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false });
	let blob;
	try {
		const project = createSoundscaperProject({ id: 'available-labels', tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice' }),
			{ id: 'locked', name: 'Locked labels', type: 'label', locked: true, labels: [] },
			...(available ? [{ id: 'writable', name: 'Writable labels', type: 'label', labels: [] }] : []),
		] });
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Available labels.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'available-labels');
	await waitForProjectActivation(editor);
	const voice = editor.locator('[data-track-row][data-track-id="voice"]');
	await voice.locator('.track-control-panel__track-name-text').click();
	await expect(voice.locator('[data-track-header]')).toHaveAttribute('data-selected', 'true');
	await chooseCommandAction(page, editor, 'Edit', 'Add label');
	await expect(editor.locator('[data-label-track][data-track-id="locked"] [data-label-id]')).toHaveCount(0);
	await expect(editor.locator('[data-label-track]').filter({ hasText: available ? 'Writable labels' : 'Labels' }).locator('[data-label-id]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-id]')).toHaveCount(0);
});
