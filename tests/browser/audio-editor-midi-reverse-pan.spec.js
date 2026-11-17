/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker, downloadBytes, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { parseMidiFile, writeMidiFile } from '../../src/common/editor/midi-file.ts';
import { openMidiAudioRenderer } from '../../src/common/editor/engine/midi-audio-renderer.ts';
import { channelEnergy, midiPanTrajectory } from '../helpers/midi-pan-trajectory.ts';

test('Reverse and MIDI export retain a recorded FluidSynth pan trajectory', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Recorded pan.mid', mimeType: 'audio/midi', buffer: Buffer.from(writeMidiFile(midiPanTrajectory())) }]);
	const clip = clipByName(editor, 'Left then right');
	await clip.click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	await editor.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('fluidsynth');
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByRole('switch', { name: 'Reverse', exact: true }).click();
	await closeClipProperties(properties);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	const download = await downloading;
	const delivered = parseMidiFile(await downloadBytes(download), { sampleRate: 8000 });
	await download.delete();
	const track = delivered.tracks.find(candidate => candidate.notes.length);
	expect(track).toBeTruthy();
	const renderer = await openMidiAudioRenderer({ version: 1, notes: track.notes,
		interchange: { tempos: [], signatures: [], events: track.events ?? [] } }, 'fluidsynth', 8000);
	try {
		const output = await renderer.render(0, 16000);
		expect(channelEnergy(output[1], 3500, 4500)).toBeGreaterThan(channelEnergy(output[0], 3500, 4500) * 10);
		expect(channelEnergy(output[0], 12000, 13000)).toBeGreaterThan(channelEnergy(output[1], 12000, 13000) * 10);
	} finally { await renderer.close(); }
});
