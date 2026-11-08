/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
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

for (const latePedal of [false, true]) test(`same-tick MIDI key release stays silent after a duration edit (late pedal ${String(latePedal)})`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const track = [0, 0x90, 60, 100, 0, 0xb0, 123, 0, ...(latePedal ? [0, 0xb0, 64, 127] : []),
		0x8f, 0, 0x80, 60, 0, 0, 255, 47, 0];
	const buffer = Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
	await editor.locator('[data-import-input]').setInputFiles({ name: 'immediate-release.mid', mimeType: 'audio/midi', buffer });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const notes = editor.getByRole('group', { name: 'Note editor', exact: true });
	await notes.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const duration = notes.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true });
	await duration.fill('2');
	await duration.press('Tab');
	const samples = await exportSamples(page, editor);
	const peak = samples.slice(4800, 40_000).reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
	// The ordinary PCM export may dither silence at the selected integer depth.
	expect(peak).toBeLessThan(0.0001);
});
