/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, commitInput, waitForProjectActivation } from './audio-editor-test-helpers.js';

test('a completed tab close remains visible when its catalogue refresh fails', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await rename('First');
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await waitForProjectActivation(editor);
	await rename('Second');
	await page.evaluate(() => {
		const original = IDBObjectStore.prototype.getAll;
		let remaining = 2;
		window.__nextCloseCatalogueFailure = false;
		IDBObjectStore.prototype.getAll = function (...args) {
			if (this.name === 'projects' && this.transaction.objectStoreNames.length === 1 && remaining > 0 && --remaining === 0) {
				window.__nextCloseCatalogueFailure = true;
				throw new DOMException('Project catalogue is temporarily unavailable.', 'UnknownError');
			}
			return original.apply(this, args);
		};
	});
	await editor.getByRole('button', { name: 'Close project: Second', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__nextCloseCatalogueFailure)).toBe(true);
	const tabs = editor.getByRole('navigation', { name: 'Project tabs' });
	await expect(tabs.getByRole('tab')).toHaveCount(1);
	await expect(tabs.getByRole('tab', { name: 'First', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect(tabs.getByRole('button', { name: 'Close project: Second', exact: true })).toHaveCount(0);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Local projects']);
	const library = page.getByRole('dialog', { name: 'Local projects', exact: true });
	await library.locator('[data-project-list]').getByRole('button', { name: /^Second Last edited:/u }).click();
	await expect(library).toHaveCount(0);
	await expect(tabs.getByRole('tab', { name: 'Second', exact: true })).toHaveAttribute('aria-selected', 'true');

	async function rename(title) {
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
		const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
		await commitInput(dialog.locator('[data-project-name-input] input'), title);
		await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
		await expect(dialog).toHaveCount(0);
	}
});
