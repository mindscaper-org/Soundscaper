/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { strFromU8, unzipSync } from 'fflate';
import { readMidiClip } from '../../src/common/editor/midi-model.ts';

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

test('right resizing selected notes shares the shortest-note limit without moving their onsets', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const events = Buffer.from('00ff510307a12078903c648360803c008268903e648360803e0000ff2f00', 'hex');
	const size = Buffer.alloc(4); size.writeUInt32BE(events.length);
	const buffer = Buffer.concat([Buffer.from('4d546864000000060000000101e04d54726b', 'hex'), size, events]);
	await importFiles(editor, [{ name: 'right-resize-group.mid', mimeType: 'audio/midi', buffer }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const fields = panel.getByRole('group', { name: 'Note editor', exact: true });
	const selected = fields.getByRole('combobox', { name: 'Selected note', exact: true });
	const duration = fields.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true });
	await selected.selectOption({ index: 1 });
	await duration.fill('0.0625'); await duration.press('Enter');
	await expect(duration).toHaveValue('0.0625');
	await expect(panel.locator('.note-rect[data-note-id="1"]')).toHaveCSS('width', '6.25px');
	const later = panel.locator('.note-rect[data-note-id="2"]');
	await later.click({ position: { x: 20, y: 5 } });
	await page.keyboard.press('ControlOrMeta+a');
	await expect(panel.locator('.note-rect--selected')).toHaveCount(2);
	const bounds = await later.boundingBox();
	if (!bounds) throw new Error('Later selected note is unavailable');
	const x = bounds.x + bounds.width - 1, y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y); await page.mouse.down();
	await page.mouse.move(x - 25, y, { steps: 3 }); await page.mouse.up();
	await expect(later).toHaveCSS('left', '100px');
	await expect(panel.locator('.note-rect--selected')).toHaveCount(2);
	await expect.poll(() => later.evaluate(element => element.style.width)).toBe('45.3125px');
	// Firefox lays out fractional widths on a 1/60px grid; the authored model
	// and requested CSS remain exact and are checked independently below.
	await expect.poll(async () => Math.abs(Number.parseFloat(await later.evaluate(element => getComputedStyle(element).width)) - 45.3125)).toBeLessThan(1 / 60);
	await expect(panel.locator('.note-rect[data-note-id="1"]')).toHaveCSS('left', '12.5px');
	await selected.selectOption({ index: 1 });
	await expect(duration).toHaveValue('0.015625');
	await selected.selectOption({ index: 2 });
	await expect(duration).toHaveValue('0.453125');
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	const saved = JSON.parse(strFromU8(unzipSync(await downloadBytes(download))['project.json']));
	await download.delete();
	const notes = readMidiClip(saved.clips[0]).notes;
	expect(notes.map(({ startFrame, durationFrames }) => ({ startFrame, durationFrames }))).toEqual([
		{ startFrame: 6000, durationFrames: 750 },
		{ startFrame: 48000, durationFrames: 21750 },
	]);
});
