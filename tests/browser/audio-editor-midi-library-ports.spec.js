/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';

test('choosing FluidSynth preserves separate MIDI port volume in exported audio', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const buffer = Buffer.from(writeMidiFile({ sampleRate: 48000, tempos: [], signatures: [], tracks: [{ name: 'Separate ports',
		notes: [{ id: 'key', pitch: 69, channel: 0, midiPort: 1, velocity: 100, startFrame: 0, durationFrames: 48000 }],
		events: [{ frame: 0, status: 0xb0, data: [7, 0] }], durationFrames: 48000,
	}] }));
	await importFiles(editor, [{ name: 'Separate ports.mid', mimeType: 'audio/midi', buffer }]);
	await clipByName(editor, 'Separate ports').click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	await editor.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('fluidsynth');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const pcm = await exportSamples(page, editor);
	expect(pcm.slice(12000, 36000).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeGreaterThan(.01);
});
