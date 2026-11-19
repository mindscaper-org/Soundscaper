/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiFileImportTracks } from '../src/common/editor/midi-file-import-tracks.ts';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import type { MidiClipData } from '../src/common/editor/midi-model.ts';
import type { MidiFileEvent } from '../src/common/editor/midi-file-types.ts';

for (const setup of ['program', 'sostenuto'] as const) test(`SMF import plays ${setup} authored on a separate channel-setup track`, async () => {
	const note = { id: 'key', pitch: 69, channel: 0, velocity: 100, startFrame: 0, durationFrames: 1600 };
	const events: MidiFileEvent[] = setup === 'program' ? [{ frame: 0, status: 0xc0, data: [80] }]
		: [{ frame: 800, status: 0xb0, data: [66, 127] }, { frame: 6400, status: 0xb0, data: [66, 0] }];
	const imported = (separate: boolean): MidiClipData => {
		const tracks = separate ? [{ name: 'Setup', notes: [], events, durationFrames: 8000 }, { name: 'Melody', notes: [note], durationFrames: 8000 }]
			: [{ name: 'Melody', notes: [note], events, durationFrames: 8000 }];
		const document = parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks }), { sampleRate: 8000 });
		const owner = midiFileImportTracks(document).find(track => track.notes.length)!;
		return { version: 1, notes: owner.notes, interchange: { events: owner.events ?? [], tempos: [], signatures: [] } };
	};
	const expected = await openMidiAudioRenderer(imported(false), 'fluidsynth', 8000);
	const actual = await openMidiAudioRenderer(imported(true), 'fluidsynth', 8000);
	try {
		const reference = await expected.render(0, 4000);
		assert.ok(reference[0]!.some(value => Math.abs(value) > .001));
		assert.deepEqual(await actual.render(0, 4000), reference, 'separating setup from notes must preserve the channel performance');
	} finally { await actual.close(); await expected.close(); }
});
