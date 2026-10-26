/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForEditor } from './audio-editor-test-helpers.js';

test('Edit here can recover after one transient project write-fence failure', async ({ page, context }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const initialTrackCount = await editor.locator('[data-track-row]').count();
	const projectId = await editor.getAttribute('data-project-id');
	const other = await context.newPage();
	try {
		await other.goto('/embed/en/'); await waitForEditor(other);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await page.evaluate(projectId => {
			const put = IDBObjectStore.prototype.put;
			let armed = true;
			IDBObjectStore.prototype.put = function (value, ...args) {
				if (armed && this.name === 'settings' && value?.key === `project-write-fence:${projectId}`) {
					armed = false;
					throw new DOMException('Temporary project lock storage failure', 'UnknownError');
				}
				return put.call(this, value, ...args);
			};
		}, projectId);
		await chooseCommandAction(page, editor, 'File', 'Edit here');
		await expect(editor.getByRole('alert').filter({ hasText: 'Temporary project lock storage failure' })).toBeVisible();
		await chooseCommandAction(page, editor, 'File', 'Edit here');
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor.locator('[data-track-row]')).toHaveCount(initialTrackCount + 1);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	} finally { await other.close(); }
});
