/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForEditor, stubStorageEstimate } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { installDesktopLinkedVideoFixture } from './helpers/linked-video-relink-fixture.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('Relink refuses changed authenticated video while same-byte relocation remains available', async ({ page }) => {
	const original = createDeterministicSilentVideoFixture('Camera.webm');
	const changed = { ...original, name: 'Metadata edited.webm', buffer: Buffer.from(original.buffer) };
	const application = changed.buffer.indexOf('Chrome'); expect(application).toBeGreaterThanOrEqual(0);
	changed.buffer[application + 5] = 0x78; // A legal application-name edit retains all image packets and exact clocks.
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await page.addInitScript(() => { Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => true }); });
	await installDesktopLinkedVideoFixture(page, { original, changed });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.getByRole('button', { name: 'Link video', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	// Model an older, already-authenticated source from before import attribution tracking.
	await page.evaluate(async ({ databaseName, projectId }) => {
		const request = indexedDB.open(databaseName);
		const database = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
		try {
			const transaction = database.transaction('projects', 'readwrite'), store = transaction.objectStore('projects');
			const read = store.get(projectId);
			const project = await new Promise((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); });
			const sources = project.sources.map(source => { const copy = { ...source }; delete copy.provenance; return copy; });
			store.put({ ...project, sources });
			await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, projectId });
	await page.reload(); await waitForEditor(page);
	const relink = async choice => {
		await page.evaluate(value => { globalThis.__videoProxyDesktopFixture.choice = value; }, choice);
		await card.getByRole('button', { name: /More file actions:/u }).click();
		await page.getByRole('menuitem', { name: 'Relink', exact: true }).click();
	};
	await relink('2');
	await expect.poll(() => binding(page, projectId)).toMatchObject({ locatorId: '2'.repeat(64) });
	const before = await binding(page, projectId);
	await relink('3');
	await expect(editor.getByRole('alert')).toContainText('Import the selected file as new media');
	await expect(page.locator('[data-project-bin-relink-changed-dialog]')).toBeHidden();
	expect(await binding(page, projectId)).toEqual(before);
});

async function binding(page, projectId) {
	return page.evaluate(async ({ databaseName, projectId }) => {
		const request = indexedDB.open(databaseName);
		const database = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
		try {
			const read = database.transaction('linkedVideoOriginalBindings').objectStore('linkedVideoOriginalBindings').getAll();
			return await new Promise((resolve, reject) => { read.onsuccess = () => resolve(read.result.map(record => record.binding).find(value => value.projectId === projectId)); read.onerror = () => reject(read.error); });
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, projectId });
}
