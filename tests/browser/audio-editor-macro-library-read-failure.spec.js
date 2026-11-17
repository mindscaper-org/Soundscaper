/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('Macro manager explains a refused New program after its saved library cannot be read', async ({ page }) => {
	await page.addInitScript(() => {
		const read = IDBObjectStore.prototype.get;
		IDBObjectStore.prototype.get = function (key) {
			if (this.name === 'settings' && key === 'audio-editor-macro-scripts-v1') {
				throw new DOMException('The saved macro library could not be read.', 'UnknownError');
			}
			return read.call(this, key);
		};
	});
	const errors = collectClientErrors(page), editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await expect(manager.getByRole('alert')).toContainText('read-only');
	await expect(manager.locator('[data-macro-script-id]')).toHaveCount(0);
	expect(errors).toEqual([]);
});
