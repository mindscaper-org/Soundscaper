/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=', 'base64');

for (const fileName of ['cover.png', 'cover\nimage.png']) test(`valid artwork files retain usable default descriptions: ${JSON.stringify(fileName)}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-metadata-editor]');
	await panel.getByRole('tab', { name: 'ID3', exact: true }).click();
	const file = { name: fileName, mimeType: 'image/png', buffer: PNG };
	await panel.getByLabel('Add artwork', { exact: true }).setInputFiles(file);
	await expect(panel.locator('.audio-editor-id3-artwork')).toHaveCount(1);
	await panel.getByLabel('Add artwork', { exact: true }).setInputFiles(file);
	await expect(panel.locator('.audio-editor-id3-artwork')).toHaveCount(2);
	const descriptions = await panel.locator('.audio-editor-id3-artwork input').evaluateAll(inputs => inputs.map(input => input.value));
	expect(new Set(descriptions).size).toBe(2);
	expect(descriptions.every(description => !/[\n\r\t]/u.test(description))).toBe(true);
	await expect(panel.getByRole('alert')).toHaveCount(0);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(panel.locator('.audio-editor-id3-artwork')).toHaveCount(1);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(panel.locator('.audio-editor-id3-artwork')).toHaveCount(2);
});
