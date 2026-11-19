/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';

// The two donor/data variants have real synthesis/store/archive custody in
// audio-editor-midi-expression-archive-custody.test.ts. Keep native Solo/export here.
for (const donorNotes of [true]) test(`a foreign channel controller reaches its owner with note-bearing donor=${donorNotes}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const note = { id: 'n', pitch: 69, channel: 1, velocity: 100, startFrame: 0, durationFrames: 48_000 };
	const buffer = Buffer.from(writeMidiFile({ sampleRate: 48_000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [
		{ name: 'Donor', notes: donorNotes ? [{ ...note, id: 'a', channel: 0, pitch: 57 }] : [],
			events: [{ frame: 0, status: 177, data: [7, 0] }], durationFrames: 48_000 },
		{ name: 'Peer', notes: [note], durationFrames: 48_000 },
	] }));
	await importFiles(editor, [{ name: 'Separate channel controls.mid', mimeType: 'audio/midi', buffer }]);
	await editor.getByRole('group', { name: 'Peer track controls', exact: true })
		.getByRole('button', { name: 'Solo', exact: true }).click();
	const pcm = await exportSamples(page, editor);
	const peak = pcm.slice(12_000, 36_000).reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
	expect(peak).toBeLessThan(0.0001);
});

test('an early channel control reaches the melody on its later MIDI port', async ({ page }, testInfo) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const port = (frame, id) => ({ frame, status: 255, metaType: 33, data: [id] });
	const note = { id: 'n', pitch: 69, channel: 1, velocity: 100, startFrame: 12_000, durationFrames: 36_000, midiPort: 2 };
	const file = testInfo.outputPath('Port setup.mid');
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [
		{ name: 'Setup', notes: [], events: [port(0, 2), { frame: 6000, status: 177, data: [7, 0] }] },
		{ name: 'Melody', notes: [note], events: [{ frame: 9000, status: 177, data: [7, 100] }, port(12_000, 2)] },
	] }));
	await importFiles(editor, file);
	const pcm = await exportSamples(page, editor);
	const peak = pcm.slice(18_000, 42_000).reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
	expect(peak).toBeLessThan(0.0001);
});
