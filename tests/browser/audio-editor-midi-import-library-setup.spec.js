/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';

test('SMF File Import keeps a separate sostenuto track audible after the key release', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const buffer = Buffer.from(writeMidiFile({ sampleRate: 48000, tempos: [], signatures: [], tracks: [
		{ name: 'Pedal setup', notes: [], durationFrames: 48000, events: [
			{ frame: 4800, status: 0xb0, data: [66, 127] }, { frame: 38400, status: 0xb0, data: [66, 0] },
		] },
		{ name: 'Melody', notes: [{ id: 'key', pitch: 69, channel: 0, velocity: 100, startFrame: 0, durationFrames: 9600 }], durationFrames: 48000 },
	] }));
	await importFiles(editor, [{ name: 'Pedal.mid', mimeType: 'audio/midi', buffer }]);
	await clipByName(editor, 'Melody').click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	await editor.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('fluidsynth');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const pcm = await exportSamples(page, editor);
	expect(pcm.slice(24000, 30000).reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)).toBeGreaterThan(.01);
});
