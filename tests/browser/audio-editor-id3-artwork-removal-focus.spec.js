/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=', 'base64');

test('keyboard artwork removal retains focus in artwork controls', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-metadata-editor]');
	await panel.getByRole('tab', { name: 'ID3', exact: true }).click();
	const add = panel.getByLabel('Add artwork', { exact: true });
	await add.setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });
	const artwork = panel.locator('.audio-editor-id3-artwork');
	await expect(artwork).toHaveCount(1);
	const remove = artwork.getByRole('button', { name: 'Remove', exact: true });
	await remove.focus();
	await remove.press('Enter');
	await expect(artwork).toHaveCount(0);
	await expect(add).toBeFocused();
});
