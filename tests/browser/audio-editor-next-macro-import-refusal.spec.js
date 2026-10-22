/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForEditor } from './audio-editor-test-helpers.js';
import { createEffectMacroLibrary } from '../../src/common/editor/effect-macro-library.js';
import { normalizeEffectMacroDraft } from '../../src/common/editor/effect-macros.js';
import { createEffect } from '../../src/common/editor/effects.js';

test('a full saved macro library reports a refused file import and permits retry after removal', async ({ page }) => {
	await bootEditor(page, '/embed/en/');
	const library = createEffectMacroLibrary({ schemaVersion: 1, defaultsInitialized: true,
		macros: Array.from({ length: 256 }, (_, index) => normalizeEffectMacroDraft({ id: `saved-${index}`,
			name: `Saved ${index}`, effects: [createEffect('audacity-invert', { id: `invert-${index}` })] })) });
	await page.evaluate(value => new Promise((resolve, reject) => {
		const opened = indexedDB.open('kw-media-soundscaper-editor-v1');
		opened.onerror = () => reject(opened.error);
		opened.onsuccess = () => {
			const database = opened.result;
			const transaction = database.transaction('settings', 'readwrite');
			transaction.objectStore('settings').put({ key: 'audio-editor-effect-macros-v1', value });
			transaction.oncomplete = () => { database.close(); resolve(); };
			transaction.onerror = () => { database.close(); reject(transaction.error); };
		};
	}), library);
	await page.reload();
	const editor = await waitForEditor(page);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await expect(manager.locator('[data-macro-list]').getByRole('button')).toHaveCount(256);
	const importFile = async () => {
		const choosing = page.waitForEvent('filechooser');
		await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
		await (await choosing).setFiles({ name: 'One more.txt', mimeType: 'text/plain', buffer: Buffer.from('Invert:\n') });
	};
	await importFile();
	await expect(manager.getByRole('alert')).toContainText('library is full');
	await expect(manager.locator('[data-macro-list]').getByRole('button', { name: 'One more', exact: true })).toHaveCount(0);
	await manager.getByRole('button', { name: 'Delete macro', exact: true }).click();
	await importFile();
	await expect(manager.getByRole('alert')).toHaveCount(0);
	await expect(manager.locator('[data-macro-list]').getByRole('button', { name: 'One more', exact: true })).toBeVisible();
});
