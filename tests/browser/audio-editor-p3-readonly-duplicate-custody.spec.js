/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, resolveBrowserProductTestUrl, waitForEditor,
	waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const dirty of [true, false]) test(`Duplicate protects visible read-only tracks; dirty=${dirty}`, async ({ page, context }) => {
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
	const row = editor.locator('[data-track-row]').first();
	const name = row.locator('.track-control-panel__track-name-text');
	const original = await name.innerText();
	if (dirty) {
		await page.evaluate(id => { window.__projectQuotaFault = id; }, projectId);
		await name.dblclick();
		const input = row.locator('[data-track-name] input');
		await input.fill('Unsaved track'); await input.press('Enter');
		await expect(name).toHaveText('Unsaved track');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'dirty');
	}
	const other = await context.newPage();
	try {
		await other.goto(resolveBrowserProductTestUrl('/embed/en/'));
		await expect(await waitForEditor(other)).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await page.bringToFront(); await page.evaluate(() => { window.__projectQuotaFault = null; });
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Duplicate project']);
		if (dirty) {
			await expect(editor.getByRole('alert').filter({ hasText: /read.only/iu }).first()).toBeVisible();
			await expect(editor).toHaveAttribute('data-project-id', projectId);
			await expect(name).toHaveText('Unsaved track');
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'dirty');
			await expect(editor.getByRole('tab')).toHaveCount(1);
		} else {
			await expect(editor).not.toHaveAttribute('data-project-id', projectId);
			await waitForProjectActivation(editor);
			await expect(editor.locator('[data-track-row]').first().locator('.track-control-panel__track-name-text')).toHaveText(original);
		}
	} finally { await other.close(); }
});
