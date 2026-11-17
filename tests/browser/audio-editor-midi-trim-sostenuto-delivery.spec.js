/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipField, closeClipProperties, commitInput, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';

test('MIDI export explains a trimmed sostenuto voice instead of saving a silent file', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const buffer = Buffer.from(writeMidiFile({ sampleRate: 48000, tempos: [], signatures: [], tracks: [{ name: 'Pedal held', durationFrames: 96000,
		notes: [{ id: 'held', pitch: 67, channel: 0, velocity: 100, startFrame: 0, durationFrames: 12000 }],
		events: [{ frame: 0, status: 0xc0, data: [40] }, { frame: 6000, status: 0xb0, data: [66, 127] }, { frame: 72000, status: 0xb0, data: [66, 0] }],
	}] }));
	await importFiles(editor, [{ name: 'Pedal held.mid', mimeType: 'audio/midi', buffer }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	await editor.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('fluidsynth');
	const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id]').first());
	await commitInput(clipField(properties, 'sourceStartFrame'), '.5');
	await closeClipProperties(properties);
	const samples = await exportSamples(page, editor);
	expect(samples.some(sample => Math.abs(sample) > .001)).toBe(true);
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	await expect(editor.getByRole('alert')).toContainText('sostenuto-held');
});
