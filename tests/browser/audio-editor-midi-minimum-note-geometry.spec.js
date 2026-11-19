/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('piano-roll box selection uses the visible body of a minimum-width note', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'short-marquee.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const fields = panel.getByRole('group', { name: 'Note editor', exact: true });
	await fields.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const duration = fields.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true });
	await duration.fill('0.001'); await duration.press('Enter');
	const note = panel.locator('.note-rect[data-note-id="1"]');
	await expect(note).toHaveCSS('width', '4px');
	const bounds = await note.boundingBox(); if (!bounds) throw new Error('Short note is not visible');
	await page.keyboard.down('ControlOrMeta');
	await page.mouse.move(bounds.x + 8, bounds.y - 5); await page.mouse.down();
	await page.mouse.move(bounds.x + 2, bounds.y + bounds.height + 5, { steps: 3 }); await page.mouse.up();
	await page.keyboard.up('ControlOrMeta');
	await expect(note).toHaveClass(/note-rect--selected/);
	await page.keyboard.press('Delete');
	await expect(note).toHaveCount(0);
});
