/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('moving a MIDI note after panning during the held drag follows the source time under the pointer', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'drag.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const noteEditor = panel.getByRole('group', { name: 'Note editor', exact: true });
	await noteEditor.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const start = noteEditor.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true });
	await start.fill('1'); await start.press('Enter');
	const note = panel.locator('.note-rect[data-note-id="1"]');
	await expect(note).toHaveCSS('left', '100px');
	const bounds = await note.boundingBox();
	if (!bounds) throw new Error('Note is not visible.');
	const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y); await page.mouse.down();
	await page.mouse.wheel(50, 0);
	await expect(note).toHaveCSS('left', '50px');
	await page.mouse.move(x + 25, y, { steps: 3 }); await page.mouse.up();
	await expect(start).toHaveValue('1.75');
});
