/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { readWavePcm } from '../helpers/read-wave-pcm.ts';
import { exportSamples } from './helpers/round2-audio-export.js';

test('extending a MIDI key retains Omni-off release in native PCM export', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const track = [0, 0x90, 60, 100, 0x83, 0x60, 0xb0, 124, 0, 0x8b, 0x20, 0x80, 60, 0, 0, 0xff, 0x2f, 0];
	const buffer = Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0,
		0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length, ...track]);
	await editor.locator('[data-import-input]').setInputFiles({ name: 'omni-off.mid', mimeType: 'audio/midi', buffer });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const notes = editor.getByRole('group', { name: 'Note editor', exact: true });
	await notes.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const duration = notes.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true });
	await expect(duration).toHaveValue('0.5');
	await duration.fill('2');
	await duration.press('Tab');
	const samples = await exportSamples(page, editor);
	expect(samples.slice(4800, 9600).some(value => Math.abs(value) > 0.02)).toBe(true);
	const peak = samples.slice(30_000, 40_000).reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
	expect(peak).toBeLessThan(0.0001);
});


// Same-tick release and late-pedal variants retain exact synthesized silence through controller/store/Scape in audio-editor-midi-conductor-channel-custody.test.ts.


test('imported MIDI channel pan reaches stereo WAV delivery through the built-in instrument', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const track = [0, 0xb0, 10, 127, 0, 0x90, 69, 100, 0x87, 0x40, 0x80, 69, 0, 0, 0xff, 0x2f, 0];
	const buffer = Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
	await editor.locator('[data-import-input]').setInputFiles({ name: 'right-panned.mid', mimeType: 'audio/midi', buffer });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const decoded = readWavePcm(await readDownloadBytes(page, link));
	expect(decoded.channels).toHaveLength(2);
	expect(decoded.channels[0].every(value => Math.abs(value) < .0001)).toBe(true);
	expect(decoded.channels[1].some(value => Math.abs(value) > .02)).toBe(true);
});

test('imported sostenuto retains released notes until pedal-up in built-in audio export', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const track = [0, 0x90, 69, 100, 120, 0xb0, 66, 127, 120, 0x80, 69, 0,
		0x83, 0x60, 0xb0, 66, 0, 0x81, 0x70, 0xff, 0x2f, 0];
	const buffer = Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
	await editor.locator('[data-import-input]').setInputFiles({ name: 'sostenuto.mid', mimeType: 'audio/midi', buffer });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const samples = await exportSamples(page, editor);
	expect(samples.slice(18_000, 24_000).some(value => Math.abs(value) > .02)).toBe(true);
	expect(samples.slice(40_000, 44_000).every(value => Math.abs(value) < .0001)).toBe(true);
});
