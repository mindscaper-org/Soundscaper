/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('moving a MIDI note after panning during the held drag follows the source time under the pointer', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
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

test('held MIDI note placement follows source time after a wheel pan', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'draw-pan.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const grid = panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]');
	const bounds = await grid.boundingBox(); if (!bounds) throw new Error('Piano-roll grid is not visible');
	const x = bounds.x + 150, y = bounds.y + 100;
	await page.mouse.move(x, y); await page.mouse.down();
	await page.mouse.wheel(50, 0);
	await expect(panel.locator('.note-rect[data-note-id="1"]')).toHaveCSS('left', '-50px');
	await page.mouse.move(x + 25, y, { steps: 3 }); await page.mouse.up();
	const fields = panel.getByRole('group', { name: 'Note editor', exact: true });
	await expect(fields.getByRole('combobox', { name: 'Selected note', exact: true }).locator('option')).toHaveCount(3);
	await expect(fields.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true })).toHaveValue('2.25');
});

test('held MIDI clip boundary resize follows source time after a wheel pan', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'trim-pan.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001500ff510307a12000903c648360803c008b20ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const bar = panel.getByText('MIDI 1', { exact: true }).locator('..');
	await expect(bar).toHaveCSS('width', '200px');
	const grid = panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]');
	const bounds = await grid.boundingBox(); if (!bounds) throw new Error('Piano-roll grid is not visible');
	const x = bounds.x + 200, y = bounds.y + 100;
	await page.mouse.move(x, y); await page.mouse.down();
	await page.mouse.wheel(50, 0);
	await expect(bar).toHaveCSS('left', '-50px');
	await page.mouse.move(x + 25, y, { steps: 3 }); await page.mouse.up();
	await expect(bar).toHaveCSS('width', '275px');
});

test('held MIDI clip strip resize follows source time after a wheel pan', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'trim-pan.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001500ff510307a12000903c648360803c008b20ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const bar = panel.getByText('MIDI 1', { exact: true }).locator('..');
	await expect(bar).toHaveCSS('width', '200px');
	const grid = panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]');
	const bounds = await grid.boundingBox(); if (!bounds) throw new Error('Piano-roll grid is not visible');
	const x = bounds.x + 200, y = bounds.y + 100;
	const barBounds = await bar.boundingBox(); if (!barBounds) throw new Error('Clip strip is not visible');
	await page.mouse.move(x - 1, barBounds.y + barBounds.height / 2); await page.mouse.down();
	await page.mouse.move(x - 1, y);
	await page.mouse.wheel(50, 0);
	await expect(bar).toHaveCSS('left', '-50px');
	await page.mouse.move(x + 24, y, { steps: 3 }); await page.mouse.up();
	await expect(bar).toHaveCSS('width', '275px');
});

test('held MIDI marquee tests the visible notes after viewport zoom', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'marquee-zoom.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const fields = panel.getByRole('group', { name: 'Note editor', exact: true });
	await fields.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const start = fields.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true });
	await start.fill('1'); await start.press('Enter');
	const note = panel.locator('.note-rect[data-note-id="1"]'); await expect(note).toHaveCSS('left', '100px');
	const grid = panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]');
	const bounds = await grid.boundingBox(); if (!bounds) throw new Error('Piano roll is not visible');
	await page.keyboard.down('ControlOrMeta');
	await page.mouse.move(bounds.x + 80, bounds.y + 43); await page.mouse.down();
	let left = 100;
	for (let count = 0; count < 10; count++) {
	await page.mouse.wheel(0, -100);
	await expect.poll(() => note.evaluate(element => parseFloat(element.style.left))).toBeGreaterThan(left + 0.5);
	left = await note.evaluate(element => parseFloat(element.style.left));
	}
	expect(left).toBeGreaterThan(130);
	await page.mouse.move(bounds.x + 110, bounds.y + 68, { steps: 3 }); await page.mouse.up();
	await page.keyboard.up('ControlOrMeta');
	await expect(note).not.toHaveClass(/note-rect--selected/);
});
