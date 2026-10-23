/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, stubStorageEstimate, closeDialog } from './audio-editor-test-helpers.js';
import { installDesktopLinkedVideoFixture } from './helpers/linked-video-relink-fixture.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

async function binding(page) {
	return await page.evaluate(async () => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open('kw-media-framescaper-editor-v1');
			request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise((resolve, reject) => {
				const read = database.transaction('linkedVideoOriginalBindings').objectStore('linkedVideoOriginalBindings').getAll();
				read.onsuccess = () => resolve(read.result[0]?.binding ?? null); read.onerror = () => reject(read.error);
			});
		} finally { database.close(); }
	});
}

test('closing an outgoing original relink cannot overwrite a newer file choice', async ({ page }) => {
	test.setTimeout(90_000);
	const original = createDeterministicSilentVideoFixture('camera.webm');
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await page.addInitScript(() => {
		Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => true });
	});
	await installDesktopLinkedVideoFixture(page, { original, changed: original });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.getByRole('button', { name: 'Link video', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const open = async () => {
		await card.getByRole('button', { name: /More file actions:/u }).click();
		await page.getByRole('menuitem', { name: 'Video proxies', exact: true }).click();
	};
	await open();
	const dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
	await page.evaluate(() => {
		globalThis.__videoProxyDesktopFixture.choice = '2'; globalThis.__videoProxyDesktopFixture.holdExact = true;
	});
	await dialog.getByRole('button', { name: 'Relink original', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__videoProxyDesktopFixture.held)).toBe(true);
	await closeDialog(dialog); await open();
	await page.evaluate(() => { globalThis.__videoProxyDesktopFixture.choice = '3'; });
	await dialog.getByRole('button', { name: 'Relink original', exact: true }).click();
	await expect(dialog.locator('[role="status"]').last()).toHaveText('Original video relinked.');
	await expect.poll(async () => (await binding(page))?.locatorId).toBe('3'.repeat(64));
	await page.evaluate(() => globalThis.__releaseRelink());
	// Wait for either abandoned-locator cleanup or the original stale publication, never an arbitrary delay.
	await expect.poll(async () => await page.evaluate(() => globalThis.__videoProxyDesktopFixture.releases.includes('2'.repeat(64)))
		|| (await binding(page))?.locatorId === '2'.repeat(64)).toBe(true);
	expect((await binding(page)).locatorId).toBe('3'.repeat(64));
});
