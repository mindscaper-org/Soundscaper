/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('left resizing selected notes at source zero preserves their onset offsets', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const events = Buffer.from('00ff510307a12078903c648360803c008268903e648360803e0000ff2f00', 'hex');
	const size = Buffer.alloc(4); size.writeUInt32BE(events.length);
	const buffer = Buffer.concat([Buffer.from('4d546864000000060000000101e04d54726b', 'hex'), size, events]);
	await importFiles(editor, [{ name: 'resize-group.mid', mimeType: 'audio/midi', buffer }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const laterNote = panel.locator('.note-rect[data-note-id="2"]');
	await expect(laterNote).toHaveCSS('left', '100px');
	await laterNote.click({ position: { x: 20, y: 5 } });
	await page.keyboard.press('ControlOrMeta+a');
	await expect(panel.locator('.note-rect--selected')).toHaveCount(2);
	const bounds = await laterNote.boundingBox(); if (!bounds) throw new Error('Later selected note is not visible');
	const x = bounds.x + 1, y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y); await page.mouse.down();
	await page.mouse.move(x - 50, y, { steps: 3 }); await page.mouse.up();
	await expect(panel.locator('.note-rect[data-note-id="1"]')).toHaveCSS('left', '0px');
	await expect(laterNote).toHaveCSS('left', '87.5px');
	await expect(panel.locator('.note-rect[data-note-id="1"]')).toHaveCSS('width', '62.5px');
	await expect(laterNote).toHaveCSS('width', '62.5px');
});
