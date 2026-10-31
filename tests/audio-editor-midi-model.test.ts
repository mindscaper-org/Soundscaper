/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import {
	MIDI_EXTENSION_KEY,
	addMidiNoteData,
	isMidiClip,
	isMidiTrack,
	normalizeMidiNotes,
	readMidiClip,
	readMidiTrack,
	removeMidiNoteData,
	updateMidiNoteData,
	withMidiClipData,
	type MidiNote,
	type MidiClipInterchange,
} from '../src/common/editor/midi-model.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

const note: MidiNote = {
	id: 'note-c4', pitch: 60, startFrame: 12_000, durationFrames: 24_000, velocity: 100, channel: 0,
};

test('MIDI clips retain editable notes alongside a normal audio fallback through project reload', () => {
	const source = createAudioSource({ id: 'fallback', frameCount: 96_000, channelCount: 1 });
	const clip = createMidiClip({
		id: 'midi-clip', sourceId: source.id, durationFrames: 96_000, notes: [note],
		opaqueExtensions: { unrelated: { preserved: true } },
	});
	const track = createMidiTrack({ id: 'midi-track', clipIds: [clip.id], instrument: 'triangle', program: 5 });
	const project = createAudioEditorProjectV17({
		id: 'midi-project', now: '2026-10-31T10:00:00.000Z', sources: [source], clips: [{ ...clip }], tracks: [{ ...track }],
	});
	const reloaded = createAudioEditorProjectV17(JSON.parse(JSON.stringify(project)) as Record<string, unknown>);

	assert.equal(validateAudioEditorProjectV17(reloaded), true);
	assert.equal(reloaded.tracks[0]?.type, 'audio');
	assert.equal(reloaded.clips[0]?.kind, 'audio');
	assert.equal(reloaded.clips[0]?.sourceId, source.id);
	assert.deepEqual(readMidiClip(reloaded.clips[0]), { version: 1, notes: [note] });
	assert.deepEqual(readMidiTrack(reloaded.tracks[0]), { version: 1, instrument: 'triangle', program: 5 });
	assert.deepEqual(reloaded.clips[0]?.opaqueExtensions.unrelated, { preserved: true });
	assert.equal(isMidiTrack(reloaded.tracks[0]), true);
	assert.equal(isMidiClip(reloaded.clips[0]), true);
});

test('MIDI edits are detached and preserve note identities and unrelated extensions', () => {
	const clip = createMidiClip({
		sourceId: 'fallback', durationFrames: 96_000, notes: [note], opaqueExtensions: { untouched: 'value' },
	});
	const original = readMidiClip(clip)!;
	const changed = updateMidiNoteData(original, note.id, { pitch: 67, velocity: 64 });
	const added = addMidiNoteData(changed, { ...note, id: 'note-g4', startFrame: 48_000 });
	const removed = removeMidiNoteData(added, [note.id]);
	const result = withMidiClipData({ ...clip }, removed);

	assert.deepEqual(original.notes, [note]);
	assert.deepEqual(readMidiClip(clip)?.notes, [note]);
	assert.deepEqual(readMidiClip(result)?.notes, [{ ...note, id: 'note-g4', startFrame: 48_000 }]);
	assert.equal(result.opaqueExtensions.untouched, 'value');
	assert.notStrictEqual(result, clip);
	assert.notStrictEqual(result.opaqueExtensions, clip.opaqueExtensions);
	assert.throws(() => addMidiNoteData(original, note), /duplicate/iu);
	assert.throws(() => updateMidiNoteData(original, 'missing', { pitch: 62 }), /missing/iu);
});

test('MIDI admission rejects invalid pitches, velocities, channels, frames and duplicate note IDs', () => {
	for (const patch of [
		{ pitch: -1 }, { pitch: 128 }, { pitch: 60.5 }, { velocity: 128 }, { velocity: -1 },
		{ channel: 16 }, { channel: -1 }, { startFrame: -1 }, { startFrame: 0.5 },
		{ durationFrames: 0 }, { startFrame: Number.MAX_SAFE_INTEGER, durationFrames: 1 }, { id: '' },
	]) {
		assert.throws(() => normalizeMidiNotes([{ ...note, ...patch }]));
	}
	assert.throws(() => normalizeMidiNotes([note, note]), /duplicate/iu);
	assert.throws(() => normalizeMidiNotes({ notes: [note] }), /array/iu);
	assert.deepEqual(normalizeMidiNotes([{ ...note, pitch: 0, velocity: 0, channel: 15 }]), [
		{ ...note, pitch: 0, velocity: 0, channel: 15 },
	]);
});

test('untagged audio remains audio and malformed or future MIDI metadata is rejected', () => {
	assert.equal(readMidiTrack({ type: 'audio', opaqueExtensions: {} }), null);
	assert.equal(readMidiClip({ kind: 'audio', opaqueExtensions: {} }), null);
	assert.equal(isMidiTrack(null), false);
	assert.equal(isMidiClip({ kind: 'video' }), false);
	assert.throws(() => readMidiClip({ kind: 'audio', opaqueExtensions: {
		[MIDI_EXTENSION_KEY]: { version: 2, notes: [] },
	} }), /version/iu);
	assert.throws(() => readMidiTrack({ type: 'audio', opaqueExtensions: {
		[MIDI_EXTENSION_KEY]: { version: 1, instrument: 'unknown' },
	} }), /instrument/iu);
	assert.throws(() => createMidiTrack({ program: 128 }), /program/iu);
});

test('MIDI track factories use the owning project rate for the shared audio controls', () => {
	const track = createMidiTrack({ instrument: 'sine' }, 8_000);
	const project = createAudioEditorProjectV17({ sampleRate: 8_000, tracks: [{ ...track }] });
	assert.equal(validateAudioEditorProjectV17(project), true);
	assert.ok(Number(track.spectrogram.maximumFrequency) <= 4_000);
});

test('project admission validates MIDI carriers before accepting a persisted document', () => {
	const source = createAudioSource({ id: 'fallback', frameCount: 96_000, channelCount: 1 });
	const clip = createMidiClip({ id: 'clip', sourceId: source.id, durationFrames: 96_000, notes: [note] });
	const track = createMidiTrack({ id: 'track', clipIds: [clip.id] });
	const project = createAudioEditorProjectV17({ sources: [source], clips: [{ ...clip }], tracks: [{ ...track }] });
	const invalid = structuredClone(project) as unknown as { clips: { opaqueExtensions: Record<string, unknown> }[] };
	invalid.clips[0]!.opaqueExtensions[MIDI_EXTENSION_KEY] = { version: 1, notes: [{ ...note, pitch: 200 }] };
	assert.throws(() => validateAudioEditorProjectV17(invalid), /pitch/iu);
	invalid.clips[0]!.opaqueExtensions[MIDI_EXTENSION_KEY] = { version: 1, notes: [{ ...note, startFrame: 95_000 }] };
	assert.throws(() => validateAudioEditorProjectV17(invalid), /fallback/iu);
	invalid.clips[0]!.opaqueExtensions[MIDI_EXTENSION_KEY] = null;
	assert.throws(() => validateAudioEditorProjectV17(invalid), /object/iu);
});

test('note edits preserve detached controller, SysEx, tempo and signature data for file export', () => {
	const interchange: MidiClipInterchange = {
		events: [
			{ frame: 0, status: 0xc0, data: [5] },
			{ frame: 12_000, status: 0xb0, data: [64, 127] },
			{ frame: 24_000, status: 0xf0, data: [0x7e, 0x7f, 0x09, 0x01, 0xf7] },
			{ frame: 24_000, status: 0xff, metaType: 0x01, data: [65] },
		],
		tempos: [{ frame: 0, bpm: 120 }, { frame: 48_000, bpm: 90 }],
		signatures: [{ frame: 0, numerator: 3, denominator: 4 }],
	};
	const clip = createMidiClip({ sourceId: 'fallback', durationFrames: 96_000, notes: [note], interchange });
	const changed = updateMidiNoteData(readMidiClip(clip)!, note.id, { durationFrames: 36_000 });
	assert.deepEqual(changed.interchange, interchange);
	assert.notStrictEqual(changed.interchange?.events, interchange.events);
	assert.notStrictEqual(changed.interchange?.events[0]?.data, interchange.events[0]?.data);
	for (const event of [
		{ frame: 0, status: 0x90, data: [60, 100] },
		{ frame: 0, status: 0xb0, data: [128, 0] },
		{ frame: 0, status: 0xc0, data: [5, 6] },
		{ frame: 0, status: 0xf8, data: [] },
		{ frame: 0, status: 0xff, data: [] },
	]) {
		assert.throws(() => createMidiClip({ sourceId: 'fallback', durationFrames: 96_000,
			interchange: { ...interchange, events: [event] } }));
	}
});
