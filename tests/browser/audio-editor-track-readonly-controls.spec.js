/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, resolveBrowserProductTestUrl, waitForEditor } from './audio-editor-test-helpers.js';

test('timeline track gain controls announce the current read-only admission', async ({ page, context }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const other = await context.newPage();
	try {
		await other.goto(resolveBrowserProductTestUrl('/embed/en/'));
		await expect(await waitForEditor(other)).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await page.bringToFront();
		const header = editor.locator('[data-track-header]').first();
		await expect(header.getByRole('slider', { name: 'Volume', exact: true })).toBeDisabled();
		await expect(header.getByRole('button', { name: 'Mute', exact: true })).toBeDisabled();
		await expect(header.getByRole('button', { name: 'Track menu', exact: true })).toBeEnabled();
	} finally { await other.close(); }
});
