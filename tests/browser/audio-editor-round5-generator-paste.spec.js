/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { importFiles } from './audio-editor-test-helpers.js';

// The established camera path supplies the collision contract for generated pictures.
test('the existing camera Paste replaces the original video at the same cursor', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	await importFiles(editor, [createDeterministicAvFixture('paste-camera.webm')]);
	const video = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(video).toHaveCount(1);
	const originalId = await video.getAttribute('data-clip-id');
	expect(originalId).toBeTruthy();
	await video.press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(video).toHaveCount(1);
	await expect(video).not.toHaveAttribute('data-clip-id', originalId);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
