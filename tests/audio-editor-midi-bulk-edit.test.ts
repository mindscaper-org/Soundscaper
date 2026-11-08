/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	updateMidiNoteData, updateMidiNotesData, type MidiClipData, type MidiNote,
} from '../src/common/editor/midi-model.ts';

const note: MidiNote = { id: 'a', pitch: 60, startFrame: 0, durationFrames: 100, velocity: 100, channel: 0 };
const fixture = (): MidiClipData => ({ version: 1, notes: [note, { ...note, id: 'b', pitch: 64 }],
	interchange: { events: [{ frame: 0, status: 0xb0, data: [64, 127] }],
		tempos: [{ frame: 0, bpm: 120 }], signatures: [{ frame: 0, numerator: 4, denominator: 4 }] } });

test('bulk MIDI edits validate the complete note inventory once per gesture', () => {
	const notes = Array.from({ length: 256 }, (_, index) => ({ ...note, id: String(index) }));
	const updates = notes.slice(0, 64).map(note => ({ id: note.id, changes: { pitch: 67 } }));
	const NativeSet = globalThis.Set;
	let inventories = 0;
	globalThis.Set = new Proxy(NativeSet, { construct(target, args) {
		inventories += 1;
		return Reflect.construct(target, args) as Set<unknown>;
	} });
	let result: MidiClipData;
	try { result = updateMidiNotesData({ version: 1, notes }, updates); }
	finally { globalThis.Set = NativeSet; }
	assert.ok(inventories <= 2, `Full note inventory validations: ${inventories}`);
	assert.deepEqual(result.notes.map(note => note.pitch), notes.map((note, index) => index < 64 ? 67 : note.pitch));
});

test('bulk MIDI edits preserve sequential changes, note order, stable IDs and detached data', () => {
	const original = fixture();
	const updates = [{ id: 'b', changes: { pitch: 70 } }, { id: 'a', changes: { velocity: 90 } },
		{ id: 'b', changes: { durationFrames: 200 } }];
	const expected = updates.reduce((data, update) => updateMidiNoteData(data, update.id, update.changes), original);
	const result = updateMidiNotesData(original, updates);
	assert.deepEqual(result, expected);
	assert.deepEqual(result.notes.map(note => note.id), ['a', 'b']);
	assert.deepEqual(original, fixture());
	assert.notStrictEqual(result.notes[0], original.notes[0]);
	assert.notStrictEqual(result.interchange?.events[0]?.data, original.interchange?.events[0]?.data);
	assert.strictEqual(updateMidiNotesData(original, []), original);
	assert.deepEqual(updateMidiNotesData(original, [{ id: 'a', changes: { ...note, id: 'other' } }]).notes[0], note);
});

test('bulk MIDI edits reject missing notes and invalid intermediate edits without mutating input', () => {
	const original = fixture();
	assert.throws(() => updateMidiNotesData(original, [{ id: 'missing', changes: {} }]), /missing/iu);
	assert.throws(() => updateMidiNotesData(original, [
		{ id: 'a', changes: { pitch: 200 } }, { id: 'a', changes: { pitch: 60 } },
	]), /pitch/iu);
	assert.throws(() => updateMidiNotesData({ ...original, notes: [note, note] }, [{ id: 'a', changes: {} }]), /duplicate/iu);
	assert.deepEqual(original, fixture());
});
