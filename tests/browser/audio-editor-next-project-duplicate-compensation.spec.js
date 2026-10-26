/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('a failed Duplicate project required write can retry without creating hidden copies', async ({ page }) => {
	await page.addInitScript(() => {
		window.__duplicateRoutingFault = { original: '', enabled: false, failures: 0 };
		const put = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (record, ...args) {
			const fault = window.__duplicateRoutingFault;
			if (fault.enabled && this.name === 'settings' && typeof record?.key === 'string'
				&& record.key.startsWith('recording-input-routing-v1:')
				&& record.key !== `recording-input-routing-v1:${fault.original}`) {
				fault.failures += 1;
				throw new DOMException('The copied routing cannot be stored.', 'QuotaExceededError');
			}
			return put.call(this, record, ...args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const original = await editor.getAttribute('data-project-id');
	await expect.poll(() => projectIds(page)).toEqual([original]);
	await page.evaluate(id => { window.__duplicateRoutingFault.original = id; window.__duplicateRoutingFault.enabled = true; }, original);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Duplicate project']);
	await expect.poll(() => page.evaluate(() => window.__duplicateRoutingFault.failures)).toBe(1);
	await expect(editor).toHaveAttribute('data-project-id', original);
	await expect.poll(() => projectIds(page)).toEqual([original]);
	await page.evaluate(() => { window.__duplicateRoutingFault.enabled = false; });
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Duplicate project']);
	await expect(editor).not.toHaveAttribute('data-project-id', original);
	await expect(editor.locator('[data-project-name]')).toHaveText('Untitled project copy');
	await expect.poll(async () => (await projectIds(page)).length).toBe(2);
});

async function projectIds(page) {
	return page.evaluate(databaseName => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const database = opening.result;
			const request = database.transaction('projects', 'readonly').objectStore('projects').getAllKeys();
			request.onerror = () => { database.close(); reject(request.error); };
			request.onsuccess = () => { database.close(); resolve(request.result); };
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}
