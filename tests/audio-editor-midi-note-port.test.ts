/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { addMidiNoteData, normalizeMidiClipData, normalizeMidiNote, updateMidiNoteData, updateMidiNotesData } from '../src/common/editor/midi-model.ts';

const note = { id: 'key', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 100 };

test('native MIDI notes preserve explicit source port zero and the full MIDI byte range', () => {
	for (const midiPort of [0, 1, 255]) assert.deepEqual(normalizeMidiNote({ ...note, midiPort }), { ...note, midiPort });
	assert.deepEqual(normalizeMidiNote(note), note);
	for (const midiPort of [-1, 256, 1.5, Number.NaN, '0']) assert.throws(() => normalizeMidiNote({ ...note, midiPort }), /port/iu);
});

test('native reload, note edits and individual copies retain their authored MIDI port', () => {
	const data = normalizeMidiClipData({ version: 1, notes: [{ ...note, midiPort: 3 }] });
	assert.equal(normalizeMidiClipData(structuredClone(data)).notes[0]?.midiPort, 3);
	assert.equal(updateMidiNoteData(data, note.id, { startFrame: 20, pitch: 62, channel: 2 }).notes[0]?.midiPort, 3);
	assert.equal(updateMidiNotesData(data, [{ id: note.id, changes: { channel: 2 } },
		{ id: note.id, changes: { velocity: 90 } }]).notes[0]?.midiPort, 3);
	const original = data.notes[0]; assert.ok(original);
	assert.equal(addMidiNoteData(data, { ...original, id: 'copy' }).notes[1]?.midiPort, 3);
});
