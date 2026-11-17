/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker, downloadBytes, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { parseMidiFile, writeMidiFile } from '../../src/common/editor/midi-file.ts';
import { openMidiAudioRenderer } from '../../src/common/editor/engine/midi-audio-renderer.ts';
import { calculateAudioSpectrum } from '../../src/common/editor/audio-spectrum.ts';
import { midiPitchRangeSetup } from '../helpers/midi-parameter-setup-fixture.ts';

for (const changing of [false, true]) test(`reversed MIDI delivery handles recorded RPN pitch range, changing=${changing}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'Pitch range.mid', mimeType: 'audio/midi', buffer: Buffer.from(writeMidiFile(midiPitchRangeSetup(changing))) }]);
	const clip = clipByName(editor, 'Recorded pitch range');
	await clip.click(); await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	await editor.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('fluidsynth');
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByRole('switch', { name: 'Reverse', exact: true }).click();
	await closeClipProperties(properties);
	if (changing) {
		const downloads = []; page.on('download', download => { downloads.push(download); });
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
		await expect(editor.getByRole('alert')).toContainText('Reversed MIDI parameter changes');
		expect(downloads).toHaveLength(0);
		return;
	}
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	const download = await downloading, document = parseMidiFile(await downloadBytes(download), { sampleRate: 8000 });
	await download.delete();
	const track = document.tracks.find(candidate => candidate.notes.length); expect(track).toBeTruthy();
	const renderer = await openMidiAudioRenderer({ version: 1, notes: track.notes,
		interchange: { tempos: [], signatures: [], events: track.events ?? [] } }, 'fluidsynth', 8000);
	try {
		const channels = await renderer.render(0, 10000);
		const peak = calculateAudioSpectrum(channels.map(channel => channel.subarray(4000, 8096)), 8000, { size: 4096 }).bins
			.reduce((loudest, bin) => bin.amplitude > loudest.amplitude ? bin : loudest).frequency;
		expect(peak).toBeGreaterThan(500); expect(peak).toBeLessThan(540);
	} finally { await renderer.close(); }
});
