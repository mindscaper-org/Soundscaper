/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('piano-roll growth preserves the lower pitch scroll limit', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'scroll-limit.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const editorFields = panel.getByRole('group', { name: 'Note editor', exact: true });
	await editorFields.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const pitch = editorFields.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true });
	await pitch.fill('0'); await pitch.press('Enter');
	const grid = panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]');
	const resize = editor.locator('[data-workspace-dock-resize-handle="bottom"]');
	const initialBounds = await grid.boundingBox(); if (!initialBounds) throw new Error('Grid is not visible');
	await resize.focus(); await resize.press('Shift+ArrowDown');
	await expect.poll(async () => (await grid.boundingBox()).height).toBeLessThan(initialBounds.height - 30);
	await grid.hover({ position: { x: 200, y: 50 } }); await page.mouse.wheel(0, 10000);
	const note = panel.locator('.note-rect[data-note-id="1"]'); await expect(note).toBeVisible();
	const oldBounds = await grid.boundingBox(); if (!oldBounds) throw new Error('Grid is not visible');
	await expect(note).toHaveCSS('top', `${oldBounds.height - 15}px`);
	await resize.focus(); await resize.press('Shift+ArrowUp');
	await expect.poll(async () => (await grid.boundingBox()).height).toBeGreaterThan(oldBounds.height + 30);
	const newBounds = await grid.boundingBox();
	await expect(note).toHaveCSS('top', `${newBounds.height - 15}px`);
});
