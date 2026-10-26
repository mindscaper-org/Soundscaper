/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

for (const full of [true, false]) test(`File New reports initial save custody and recovers; full=${full}`, async ({ page }) => {
	await page.addInitScript(() => {
		for (const method of ['add', 'put']) {
			const original = IDBObjectStore.prototype[method];
			IDBObjectStore.prototype[method] = function (value, ...args) {
				if (this.name === 'projects' && window.__newQuotaFault && value?.id !== window.__oldProjectId) {
					throw new DOMException('Project storage is full', 'QuotaExceededError');
				}
				return original.call(this, value, ...args);
			};
		}
	});
	const editor = await bootEditor(page, '/embed/en/');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const oldId = await editor.getAttribute('data-project-id');
	await page.evaluate(({ full, oldId }) => { window.__newQuotaFault = full; window.__oldProjectId = oldId; }, { full, oldId });
	await chooseFileAction(page, editor, 'New');
	await expect(editor).not.toHaveAttribute('data-project-id', oldId);
	await waitForProjectActivation(editor);
	const id = await editor.getAttribute('data-project-id');
	if (full) {
		expect(await storedProject(page, id)).toBeNull();
		await expect(editor.getByRole('alert').filter({ hasText: /storage is full/iu }).first()).toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'dirty');
	} else {
		expect(await storedProject(page, id)).not.toBeNull();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	}
	await page.evaluate(() => { window.__newQuotaFault = false; });
	const row = editor.locator('[data-track-row]').first();
	await row.locator('.track-control-panel__track-name-text').dblclick();
	const input = row.locator('[data-track-name] input');
	await input.fill('Retry after storage is available'); await input.press('Enter');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await expect.poll(async () => (await storedProject(page, id))?.tracks[0]?.name).toBe('Retry after storage is available');
	await page.reload(); await waitForProjectActivation(await waitForEditor(page));
	await expect(editor).toHaveAttribute('data-project-id', id);
	await expect(editor.locator('.track-control-panel__track-name-text').first()).toHaveText('Retry after storage is available');
});

async function storedProject(page, id) {
	return page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName); opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const db = opening.result, read = db.transaction('projects').objectStore('projects').get(id);
			read.onerror = () => { db.close(); reject(read.error); };
			read.onsuccess = () => { resolve(read.result ?? null); db.close(); };
		};
	}), { databaseName: SOUNDSCAPER_DATABASE_NAME, id });
}
