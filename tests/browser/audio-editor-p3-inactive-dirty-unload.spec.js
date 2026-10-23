/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, commitInput,
	resolveBrowserProductTestUrl, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const changed of [false, true]) test(`leaving a clean active project protects retained ${changed ? 'unsaved' : 'saved'} read-only history`, async ({ page, context }) => {
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
	if (changed) {
		await page.evaluate(id => { window.__projectQuotaFault = id; }, projectId);
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
		const rename = page.getByRole('dialog', { name: 'Rename project', exact: true });
		await commitInput(rename.locator('[data-project-name-input] input'), 'Unsaved narration');
		await rename.getByRole('button', { name: 'Save name', exact: true }).click();
		await expect(editor.locator('[data-project-name]')).toHaveText('Unsaved narration');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'dirty');
	}
	const other = await context.newPage();
	try {
		await other.goto(resolveBrowserProductTestUrl('/embed/en/'));
		await expect(await waitForEditor(other)).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await page.bringToFront(); await page.evaluate(() => { window.__projectQuotaFault = null; });
		await chooseFileAction(page, editor, 'New');
		await expect(editor).not.toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const warnings = await page.evaluate(() => {
			const event = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(event); return event.defaultPrevented;
		});
		expect(warnings, 'closing the browser must warn while another retained tab has unsaved edits').toBe(changed);
		if (changed) {
			const confirmation = page.waitForEvent('dialog');
			const reloading = page.evaluate(() => { window.location.reload(); });
			const dialog = await confirmation; expect(dialog.type()).toBe('beforeunload');
			await dialog.dismiss(); await reloading;
			await editor.getByRole('tab', { name: 'Unsaved narration', exact: true }).click();
			await expect(editor).toHaveAttribute('data-project-id', projectId);
			await waitForProjectActivation(editor); await expect(editor.locator('[data-project-name]')).toHaveText('Unsaved narration');
		}
	} finally { await other.close(); }
});
