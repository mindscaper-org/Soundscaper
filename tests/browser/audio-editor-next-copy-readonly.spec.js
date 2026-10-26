/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, importFiles, resolveBrowserProductTestUrl, waitForEditor } from './audio-editor-test-helpers.js';

for (const shortcut of [false, true]) test(`a read-only project tab can copy its recording through ${shortcut ? 'the keyboard' : 'the menu'}`, async ({ page, context }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Read-only source.wav', duration: 0.5 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const other = await context.newPage();
	try {
		await other.goto(resolveBrowserProductTestUrl('/embed/en/'));
		await expect(await waitForEditor(other)).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await page.bringToFront();
		if (shortcut) await page.keyboard.press('ControlOrMeta+c');
		else await chooseCommandAction(page, editor, 'Edit', 'Copy');
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await chooseFileAction(page, editor, 'New');
		await expect(editor).not.toHaveAttribute('data-project-id', projectId);
		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.getByRole('group', { name: /^Read-only source\.wav clip, starts at 0 seconds, 0\.5 seconds long$/u })).toHaveCount(1);
	} finally { await other.close(); }
});
