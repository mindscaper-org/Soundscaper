/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

test('Manage labels keeps locked file cues protected while editable peer cues remain writable', async ({ page }) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	let archive;
	try {
		archive = (await exportScapeProject(createSoundscaperProject({ id: 'protected-manager-file', tracks: [
			{ id: 'locked', type: 'label', name: 'Protected cues', locked: true, labels: [{ id: 'keep', title: 'Keep me', startFrame: 0, endFrame: 48_000 }] },
			{ id: 'editable', type: 'label', name: 'Editable cues', labels: [{ id: 'edit', title: 'Edit me', startFrame: 0, endFrame: 48_000 }] },
		] }), store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Protected cues.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'protected-manager-file');
	await waitForProjectActivation(editor);
	await editor.locator('[data-track-row][data-track-id="locked"] .track-control-panel__track-name-text').click();
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	const locked = panel.locator('[data-label-id="keep"]'), editable = panel.locator('[data-label-id="edit"]');
	await expect(locked.getByRole('textbox', { name: 'Label title: Protected cues', exact: true })).toBeDisabled();
	await expect(locked.getByRole('button', { name: 'Delete label: Keep me', exact: true })).toBeDisabled();
	await expect(locked.getByRole('button', { name: 'Time selection', exact: true })).toBeEnabled();
	await editable.getByRole('textbox', { name: 'Label title: Editable cues', exact: true }).fill('Changed cue');
	await editable.getByRole('textbox').press('Enter');
	await expect(editable.getByRole('textbox')).toHaveValue('Changed cue');
	await expect(panel.getByRole('button', { name: 'New label', exact: true })).toBeDisabled();
	await expect(panel.locator('[data-track-id="locked"]')).toHaveCount(1);
	await expect(panel.locator('[data-track-id="editable"]')).toHaveCount(1);
	await expect(editor.locator('[role="alert"]')).toHaveCount(0);
});
