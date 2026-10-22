/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';

registerAudioEditorHooks();

test('Nyquist analysis of an opened project publishes its labels into the visible sequence', async ({ page }) => {
	const project = createSoundscaperProject({ id: 'nyquist-label-sequence', title: 'Two sequences', primarySequenceId: 'main',
		sequences: [{ id: 'other', trackIds: ['hidden-labels'] }, { id: 'main', trackIds: ['visible-labels'] }],
		tracks: [{ id: 'hidden-labels', type: 'label', name: 'Hidden labels', labels: [] },
			{ id: 'visible-labels', type: 'label', name: 'Visible labels', labels: [] }],
	});
	const archive = await exportScapeProject(project, { async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); } });
	expect(archive.blob).toBeInstanceOf(Blob);
	const editor = await bootEditor(page, '/embed/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: 'two-sequences.sscape', mimeType: SCAPE_MIME_TYPE,
		buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill("'((0.1 0.2 \"Speech\"))");
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(editor.locator('[data-track-row][data-track-id="visible-labels"]')).toContainText('Speech');
	await expect(editor.locator('[data-track-row][data-track-id="hidden-labels"]')).not.toContainText('Speech');
});
