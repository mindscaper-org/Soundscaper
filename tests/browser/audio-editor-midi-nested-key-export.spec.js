/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { parseAllegroFile } from '../../src/common/editor/allegro-file.ts';

test('nested same-key notes refuse misleading MIDI and remain exportable as Allegro', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const fields = editor.getByRole('group', { name: 'Note editor', exact: true });
	const add = panel.getByRole('button', { name: 'Add note', exact: true });
	const select = fields.getByRole('combobox', { name: 'Selected note', exact: true });
	await add.click();
	await expect(select.getByRole('option')).toHaveCount(2);
	const duration = fields.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true });
	await duration.fill('0.5');
	await duration.press('Tab');
	await expect(duration).toHaveValue('0.5');
	await add.click();
	await expect(select.getByRole('option')).toHaveCount(3);
	const start = fields.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true });
	await start.fill('0.125');
	await start.press('Tab');
	await duration.fill('0.125');
	await duration.press('Tab');
	const velocity = fields.getByRole('spinbutton', { name: 'Velocity', exact: true });
	await velocity.fill('60');
	await velocity.press('Tab');
	await expect(start).toHaveValue('0.125');
	await expect(duration).toHaveValue('0.125');
	await expect(velocity).toHaveValue('60');
	const downloads = [];
	page.on('download', download => downloads.push(download));
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	await expect(page.locator('[data-editor-toast="workspace-error"]')).toContainText(
		'MIDI export cannot preserve overlapping notes on the same MIDI key. Export Allegro or save the native project.');
	expect(downloads).toHaveLength(0);
	await select.selectOption({ index: 1 });
	await expect(duration).toHaveValue('0.5');
	await select.selectOption({ index: 2 });
	await expect(start).toHaveValue('0.125');
	await expect(duration).toHaveValue('0.125');
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export Allegro (beta)']);
	const download = await downloading;
	const bytes = await downloadBytes(download);
	await download.delete();
	const reopened = parseAllegroFile(new TextDecoder().decode(bytes), { sampleRate: 48_000 }).tracks.flatMap(track => track.notes);
	expect(reopened.map(note => [note.startFrame, note.durationFrames, note.velocity]))
		.toEqual([[0, 24_000, 100], [6000, 6000, 60]]);
});
