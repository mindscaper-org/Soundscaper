/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';

test('a reset refused while another editor window is open restores the active project', async ({ page, context }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await expect(clipByName(editor, toneA.name)).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const id = await editor.getAttribute('data-project-id');
	const other = await context.newPage();
	try {
		const otherEditor = await bootEditor(other, '/embed/en/');
		await waitForProjectActivation(otherEditor);
		await expect(otherEditor).toHaveAttribute('data-project-id', id);
		await otherEditor.getByRole('button', { name: 'New project', exact: true }).click();
		await waitForProjectActivation(otherEditor);
		const otherId = await otherEditor.getAttribute('data-project-id');
		expect(otherId).not.toBe(id);
		await page.bringToFront();
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Clear all local editor data']);
		const confirmation = page.getByRole('dialog', { name: 'Clear all local editor data', exact: true });
		await confirmation.getByRole('button', { name: 'Clear all local editor data', exact: true }).click();
		await expect(editor.getByRole('alert').filter({ hasText: 'Another editor session still owns local source history.' })).toBeVisible();
		await expect(editor).toHaveAttribute('data-project-id', id);
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await expect(otherEditor).toHaveAttribute('data-project-id', otherId);
	} finally { await other.close(); }
});
