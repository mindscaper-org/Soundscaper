/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles, collectClientErrors } from './audio-editor-test-helpers.js';

test('deleting a MIDI note during its held drag retires the obsolete edit', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'delete-drag.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const note = panel.locator('.note-rect[data-note-id="1"]');
	const bounds = await note.boundingBox(); if (!bounds) throw new Error('Note is not visible');
	const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y); await page.mouse.down();
	await page.mouse.move(x + 25, y, { steps: 3 });
	await page.keyboard.press('Delete');
	await expect(panel.locator('.note-rect:not(.note-rect--ghost)')).toHaveCount(0);
	await page.mouse.move(x + 50, y, { steps: 3 }); await page.mouse.up();
	await expect(editor.getByText(/MIDI note .* is missing\./)).toHaveCount(0);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(panel.locator('.note-rect[data-note-id="1"]')).toHaveCSS('left', '0px');
	expect(errors).toEqual([]);
});
