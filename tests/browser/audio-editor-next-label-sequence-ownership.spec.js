/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

for (const existing of [false, true]) test(`Add label stays in the focused sequence; existing label track=${existing}`, async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false });
	let blob;
	try {
		const project = createSoundscaperProject({ id: 'label-sequences', tracks: [
			...(existing ? [{ id: 'own-labels', name: 'Own labels', type: 'label', labels: [] }] : []),
			createAudioTrack({ id: 'voice', name: 'Voice' }), { id: 'foreign-labels', name: 'Foreign labels', type: 'label', labels: [] },
		], sequences: [{ id: 'main', trackIds: [...(existing ? ['own-labels'] : []), 'voice'] },
			{ id: 'other', trackIds: ['foreign-labels'] }], primarySequenceId: 'main' });
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Label sequences.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'label-sequences');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	await editor.locator('[data-track-row][data-track-id="voice"] .track-control-panel__track-name-text').click();
	await chooseCommandAction(page, editor, 'Edit', 'Add label');
	await expect(editor.locator('[data-label-track][data-track-id="foreign-labels"] [data-label-id]')).toHaveCount(0);
	await expect(editor.locator('[data-label-track]').filter({ hasText: existing ? 'Own labels' : 'Labels' }).locator('[data-label-id]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-id]')).toHaveCount(0);
});
