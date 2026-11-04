/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { MIDI_FILE_MAX_EVENTS, MIDI_FILE_MAX_TRACKS, type MidiFileDocument } from '../src/common/editor/midi-file-types.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

test('MIDI import and re-export preserve explicit end-of-track trailing silence', () => {
	const events = [0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, 0, 0x9a, 0x20, 0xff, 0x2f, 0];
	const file = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
	const imported = parseMidiFile(file);
	assert.equal(imported.tracks[0]?.durationFrames, 192_000);
	const reopened = parseMidiFile(writeMidiFile(imported));
	assert.equal(reopened.tracks.find(track => track.notes.length)?.durationFrames, 192_000);
});

test('MIDI export preserves edited clip extent and encloses quantized note-off events', () => {
	const clip = createMidiClip({ id: 'clip', sourceId: 'source', title: 'Moved clip', timelineStartFrame: 48_000,
		sourceStartFrame: 0, sourceDurationFrames: 36_000, durationFrames: 36_000,
		notes: [{ id: 'n', pitch: 60, velocity: 90, channel: 0, startFrame: 0, durationFrames: 1000 }] });
	const track = createMidiTrack({ id: 'track', name: 'MIDI', clipIds: ['clip'] });
	const exported = midiDocumentFromProject({ sampleRate: 48_000, tracks: [{ ...track }], clips: [{ ...clip }] });
	assert.equal(parseMidiFile(writeMidiFile(exported)).tracks.find(track => track.notes.length)?.durationFrames, 84_000);
	const document: MidiFileDocument = { sampleRate: 48_000, tracks: [{ name: 'Tiny', durationFrames: 1,
		notes: [{ id: 'n', pitch: 60, velocity: 90, channel: 0, startFrame: 0, durationFrames: 1 }] }], tempos: [], signatures: [] };
	const tiny = parseMidiFile(writeMidiFile(document)).tracks.find(track => track.notes.length)!;
	assert.ok(tiny.durationFrames! >= tiny.notes[0]!.startFrame + tiny.notes[0]!.durationFrames);
});

test('Allegro unqualified named pitches use the format octave rather than the preceding note octave', () => {
	assert.deepEqual(parseAllegroFile('T0 V0 P72 U0.1\nC U0.1\n').tracks[0]?.notes.map(note => note.pitch), [72, 12]);
});

test('Allegro accidentals after explicit octaves are accepted', () => {
	assert.deepEqual(parseAllegroFile('T0 V0 C4S U0.1\nD4F U0.1\n').tracks[0]?.notes.map(note => note.pitch), [61, 61]);
});

test('Allegro repeated dot modifiers retain PortSMF duration semantics', () => {
	assert.equal(parseAllegroFile('T0 -tempor:120\nT0 V0 P60 Q..\n').tracks[0]?.notes[0]?.durationFrames, 54_000);
});

test('Allegro duration modifiers may follow a multiplier or numeric duration', () => {
	const notes = parseAllegroFile('T0 -tempor:120\nT0 V0 P60 UQ2T\nT2 V0 P62 U0.5T\n').tracks[0]?.notes;
	assert.deepEqual(notes?.map(note => note.durationFrames), [32_000, 16_000]);
});

test('Allegro offsets move tempo and signature changes together with their notes', () => {
	const parsed = parseAllegroFile('#offset 1\nT0 -tempor:120\nT0 V- -timesig_numr:4 -timesig_denr:4\nT0.5 -tempor:60\nT0.5 V- -timesig_numr:3 -timesig_denr:4\nT0.5 V0 P60 U0.5\n');
	assert.equal(parsed.tracks[0]?.notes[0]?.startFrame, 72_000);
	assert.equal(parsed.tempos.find(tempo => tempo.bpm === 60)?.frame, 72_000);
	assert.equal(parsed.signatures.find(signature => signature.numerator === 3)?.frame, 72_000);
});

test('MIDI files at the admitted 256-track limit remain importable and exportable', () => {
	const bytes = [77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 1, 0, 1, 224];
	const track = [0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0];
	for (let index = 0; index < MIDI_FILE_MAX_TRACKS; index += 1) bytes.push(77, 84, 114, 107, 0, 0, 0, track.length, ...track);
	const imported = parseMidiFile(Uint8Array.from(bytes));
	const parsed = parseMidiFile(writeMidiFile(imported));
	assert.equal(parsed.tracks.length, MIDI_FILE_MAX_TRACKS);
	assert.equal(parsed.tracks.reduce((sum, track) => sum + track.notes.length, 0), MIDI_FILE_MAX_TRACKS);
});

test('MIDI export refuses output whose doubled note messages exceed its own reader event limit', () => {
	const notes = Array.from({ length: 250 }, (_, index) => ({
		id: `n${index}`, pitch: 60, channel: 0, velocity: 90, startFrame: index * 384, durationFrames: 192,
	}));
	const period = 96_000;
	const repeats = 500;
	const imported = parseMidiFile(writeMidiFile({ sampleRate: 48_000, tracks: [{ name: 'Repeated clip', notes, durationFrames: period }], tempos: [], signatures: [] }));
	const content = imported.tracks.find(track => track.notes.length)!;
	const clip = createMidiClip({ id: 'clip', sourceId: 'source', title: 'Imported', timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: period, durationFrames: period, notes: content.notes });
	const loop = { ...clip, ...clipLoopUpdateFields({ ...clip, durationFrames: period }, { periodFrames: period, durationFrames: period * repeats }) };
	const track = createMidiTrack({ id: 'track', name: 'Repeated', clipIds: ['clip'] });
	const project = createAudioEditorProjectV17({ sampleRate: 48_000, tracks: [{ ...track }], clips: [loop],
		sources: [{ id: 'source', kind: 'audio', name: 'Imported MIDI', storageKey: 'source', sampleFormat: 'float32',
			sampleRate: 48_000, frameCount: period, channelCount: 1 }] });
	assert.equal(project.schemaVersion, 17);
	const exported = midiDocumentFromProject({ ...project });
	assert.equal(exported.tracks[0]?.notes.length, notes.length * repeats);
	assert.equal(notes.length * repeats * 2, MIDI_FILE_MAX_EVENTS);
	assert.throws(() => writeMidiFile(exported), /event.*limit|too many events/i);
});

test('MIDI note-off release velocity survives import, project export, and file reopen', () => {
	for (const velocity of [0, 81]) {
		const parsed = parseMidiFile(singleTrack([0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, velocity, 0, 0xff, 0x2f, 0]));
		assert.equal(parsed.tracks[0]?.notes[0]?.releaseVelocity, velocity || undefined);
		const clip = createMidiClip({ id: 'clip', sourceId: 'source', title: 'Imported', timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: 24_000, durationFrames: 24_000, notes: parsed.tracks[0]!.notes });
		const track = createMidiTrack({ id: 'track', name: 'MIDI', clipIds: ['clip'] });
		const exported = midiDocumentFromProject({ sampleRate: 48_000, tracks: [{ ...track }], clips: [{ ...clip }] });
		assert.equal(parseMidiFile(writeMidiFile(exported)).tracks.find(track => track.notes.length)?.notes[0]?.releaseVelocity, velocity || undefined);
	}
	const zeroOn = parseMidiFile(singleTrack([0, 0x90, 60, 90, 0x83, 0x60, 0x90, 60, 0, 0, 0xff, 0x2f, 0]));
	assert.equal(zeroOn.tracks[0]?.notes[0]?.releaseVelocity, 64);
	assert.equal(parseMidiFile(writeMidiFile(zeroOn)).tracks.find(track => track.notes.length)?.notes[0]?.releaseVelocity, 64);
});

test('MIDI All Notes Off and All Sound Off close old keys before a repeated-pitch performance', () => {
	for (const controller of [120, 123]) {
		const parsed = parseMidiFile(singleTrack([0, 0x90, 60, 90, 120, 0xb0, controller, 0,
			120, 0x90, 60, 90, 120, 0x80, 60, 0, 120, 0xff, 0x2f, 0]));
		assert.deepEqual(parsed.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[0, 6000], [12_000, 6000]]);
	}
	const independent = parseMidiFile(singleTrack([0, 0x90, 60, 90, 0, 0x91, 60, 90,
		120, 0xb0, 123, 0, 120, 0x81, 60, 0, 0, 0xff, 0x2f, 0]));
	assert.deepEqual(independent.tracks[0]?.notes.map(note => [note.channel, note.durationFrames]), [[0, 6000], [1, 12_000]]);
});

test('a valid long-held MIDI note can be re-exported without overflowing the output delta field', () => {
	const imported = parseMidiFile(singleTrack([0, 0x90, 60, 90, 0x86, 0xcb, 0xe0, 0,
		0x80, 60, 0, 0, 0xff, 0x2f, 0]));
	assert.equal(imported.tracks[0]?.notes[0]?.durationFrames, 691_200_000);
	const reopened = parseMidiFile(writeMidiFile(imported));
	const track = reopened.tracks.find(track => track.notes.length)!;
	assert.equal(track.notes[0]?.durationFrames, 691_200_000);
	assert.equal(track.durationFrames, 691_200_000);
	assert.deepEqual(track.events ?? [], []);
});

function singleTrack(events: readonly number[]): Uint8Array {
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
}
