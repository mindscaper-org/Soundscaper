/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

for (const shorter of [false, true]) test(`refused ${shorter ? 'shortfall' : 'immediate'} Bin replacement releases its staged audio`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createWavFixture({ name: 'Original.wav', duration: 1 }));
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	const sourceId = await card.getAttribute('data-source-id');
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(), 'Lock track');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const before = await storedSourceIds(page); expect(before).toEqual([sourceId]);
	await card.getByRole('button', { name: /More file actions/u }).click();
	const choosing = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Replace', exact: true }).click();
	await (await choosing).setFiles(createWavFixture({ name: 'Replacement.wav', duration: shorter ? .5 : 1, frequency: 660 }));
	if (shorter) {
		const choice = page.locator('[data-project-bin-replacement-dialog]'); await expect(choice).toBeVisible();
		await choice.getByRole('button', { name: 'Keep timeline spacing', exact: true }).click();
		await expect(choice).toBeHidden();
	}
	await expect(editor.getByRole('alert').filter({ hasText: /locked/iu }).first()).toBeVisible();
	await expect.poll(() => storedSourceIds(page)).toEqual(before);
	await expect(card).toHaveAttribute('data-source-id', sourceId);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});

async function storedSourceIds(page) {
	return page.evaluate(databaseName => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const database = opening.result, transaction = database.transaction('sources', 'readonly');
			const request = transaction.objectStore('sources').getAllKeys();
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result.map(String).sort());
			transaction.oncomplete = () => database.close();
			transaction.onabort = () => { database.close(); reject(transaction.error); };
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}
