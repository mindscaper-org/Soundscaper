/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { addMidiNoteData, normalizeMidiClipData, normalizeMidiNote, updateMidiNoteData, updateMidiNotesData } from '../src/common/editor/midi-model.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';

const note = { id: 'killed', pitch: 69, velocity: 100, startFrame: 0, durationFrames: 1, channel: 0,
	onsetStop: { kind: 'all-sound-off' as const, frame: 0, channel: 0 } };
const data = { version: 1 as const, notes: [note], interchange: {
	events: [{ frame: 0, status: 0xb0, data: [120, 0] }], tempos: [], signatures: [],
} };

test('native MIDI note normalization retains validated onset-stop provenance and rejects stale bindings', () => {
	assert.deepEqual(normalizeMidiNote(note), note);
	for (const onsetStop of [{ ...note.onsetStop, frame: 1 }, { ...note.onsetStop, channel: 1 },
		{ ...note.onsetStop, kind: 'all-notes-off' }, { ...note.onsetStop, frame: -1 }]) {
		assert.throws(() => normalizeMidiNote({ ...note, onsetStop }), /onset|stop/iu);
	}
	assert.deepEqual(normalizeMidiClipData({ version: 1, notes: [note] }).notes[0]?.onsetStop, note.onsetStop,
		'the causal stop can be authored on another synchronous MIDI track');
});

test('editing the original pitch or velocity preserves its kill; moving/changing channel and individual cloning retire it', () => {
	const changed = updateMidiNoteData(data, note.id, { pitch: 72, velocity: 80 });
	assert.deepEqual(changed.notes[0]?.onsetStop, note.onsetStop);
	for (const changes of [{ startFrame: 100 }, { channel: 1 }]) {
		assert.equal(updateMidiNoteData(data, note.id, changes).notes[0]?.onsetStop, undefined);
		assert.equal(updateMidiNotesData(data, [{ id: note.id, changes }, { id: note.id, changes: { velocity: 70 } }]).notes[0]?.onsetStop, undefined);
	}
	const cloned = addMidiNoteData(data, { ...note, id: 'copy' });
	assert.equal(cloned.notes[1]?.onsetStop, undefined);
	assert.deepEqual(normalizeMidiClipData(data).notes[0]?.onsetStop, note.onsetStop, 'whole native carriers preserve their authoring');
});

for (const instrument of ['triangle', 'square'] as const) test(`${instrument} synthesis never sustains a voice proven killed at its onset`, () => {
	const samples = renderMidiFrames([note], instrument, 8000, 0, 8000,
		[{ frame: 0, status: 0xb0, data: [64, 127] }, { frame: 0, status: 0xb0, data: [120, 0] }]);
	assert.ok(samples.every(value => value === 0));
	const ordinary = { ...note, id: 'ordinary', durationFrames: 4000, onsetStop: undefined };
	assert.ok(renderMidiFrames([ordinary], instrument, 8000, 0, 8000,
		[{ frame: 0, status: 0xb0, data: [64, 127] }, { frame: 0, status: 0xb0, data: [120, 0] }]).some(value => value !== 0));
});
