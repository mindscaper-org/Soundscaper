/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('piano-roll edge resize uses the note position after a horizontal wheel pan', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'quarter.mid', mimeType: 'audio/midi',
		buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const noteEditor = panel.getByRole('group', { name: 'Note editor', exact: true });
	await noteEditor.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const start = noteEditor.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true });
	await start.fill('1');
	await start.press('Enter');
	const note = panel.locator('.note-rect[data-note-id="1"]');
	await expect(note).toHaveCSS('left', '100px');
	const bounds = await note.boundingBox();
	if (!bounds) throw new Error('MIDI note is not visible.');
	const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.wheel(23, 0);
	await expect(note).toHaveCSS('left', '77px');
	expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-note-id]')?.getAttribute('data-note-id'), { x, y })).toBe('1');
	await page.mouse.down();
	await page.mouse.move(x + 25, y, { steps: 3 });
	await page.mouse.up();
	await expect(start).toHaveValue('1');
	await expect(noteEditor.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true })).toHaveValue('0.75');
});

test('a short MIDI note retains a body that can be dragged', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'staccato.mid', mimeType: 'audio/midi',
		buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const noteEditor = panel.getByRole('group', { name: 'Note editor', exact: true });
	await noteEditor.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const duration = noteEditor.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true });
	await duration.fill('0.02');
	await duration.press('Enter');
	const note = panel.locator('.note-rect[data-note-id="1"]');
	await expect(note).toHaveCSS('width', '4px');
	const bounds = await note.boundingBox();
	if (!bounds) throw new Error('MIDI note is not visible.');
	const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 25, y, { steps: 3 });
	await page.mouse.up();
	await expect(noteEditor.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true })).toHaveValue('0.25');
	await expect(duration).toHaveValue('0.02');
});

test('line-mode wheel input scrolls complete piano-roll note rows', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'scroll.mid', mimeType: 'audio/midi',
		buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const note = panel.locator('.note-rect[data-note-id="1"]');
	await expect(note).toHaveCSS('top', '49px');
	await panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]').evaluate(element => {
		element.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE, bubbles: true, cancelable: true }));
	});
	await expect(note).toHaveCSS('top', '1px');
});
