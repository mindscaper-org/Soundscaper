/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, commitInput,
	resolveBrowserProductTestUrl, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const inactive of [false, true]) test(`closing an ${inactive ? 'inactive' : 'active'} read-only tab preserves unsaved edits`, async ({ page, context }) => {
	test.setTimeout(90_000);
	await page.addInitScript(() => {
		const put = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value, ...args) {
			if (this.name === 'projects' && value?.id === window.__projectQuotaFault) throw new DOMException('Project storage is full', 'QuotaExceededError');
			return put.call(this, value, ...args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	await page.evaluate(id => { window.__projectQuotaFault = id; }, projectId);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const rename = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(rename.locator('[data-project-name-input] input'), 'Unsaved narration');
	await rename.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'dirty');
	const other = await context.newPage();
	try {
		await other.goto(resolveBrowserProductTestUrl('/embed/en/'));
		await expect(await waitForEditor(other)).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await page.bringToFront(); await page.evaluate(() => { window.__projectQuotaFault = null; });
		if (inactive) {
			await chooseFileAction(page, editor, 'New');
			await expect(editor).not.toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
		}
		await editor.getByRole('button', { name: 'Close project: Unsaved narration', exact: true }).click();
		await expect(editor.getByRole('tab', { name: 'Unsaved narration', exact: true })).toHaveCount(1);
		await expect(editor.getByRole('alert').filter({ hasText: /read.only/iu }).first()).toBeVisible();
		if (inactive) await editor.getByRole('tab', { name: 'Unsaved narration', exact: true }).click();
		await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
		await expect(editor.locator('[data-project-name]')).toHaveText('Unsaved narration');
	} finally { await other.close(); }
});
