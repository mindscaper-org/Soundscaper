/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import type { MidiFileDocument } from '../src/common/editor/midi-file-types.ts';

function smf(tracks: readonly number[][], division = 480, format = tracks.length > 1 ? 1 : 0): Uint8Array {
	const bytes = [77, 84, 104, 100, 0, 0, 0, 6, 0, format, tracks.length >> 8, tracks.length & 255, division >> 8, division & 255];
	for (const track of tracks) bytes.push(77, 84, 114, 107, 0, 0, track.length >> 8, track.length & 255, ...track);
	return Uint8Array.from(bytes);
}

test('MIDI type 1 applies conductor tempo changes to notes with running status and zero-velocity note off', () => {
	const parsed = parseMidiFile(smf([
		[0, 255, 81, 3, 7, 161, 32, 0x83, 0x60, 255, 81, 3, 15, 66, 64, 0, 255, 47, 0],
		[0, 255, 3, 4, 76, 101, 97, 100, 0, 0x92, 60, 100, 0x87, 0x40, 60, 0, 0, 255, 47, 0],
	]), { sampleRate: 48_000 });
	assert.equal(parsed.tracks[1]?.name, 'Lead');
	assert.deepEqual(parsed.tracks[1]?.notes.map(({ id: _id, ...note }) => note), [{
		pitch: 60, velocity: 100, channel: 2, startFrame: 0, durationFrames: 72_000, releaseVelocity: 64,
	}]);
	assert.deepEqual(parsed.tempos, [{ frame: 0, bpm: 120 }, { frame: 24_000, bpm: 60 }]);
});

test('MIDI roundtrip preserves polyphony, channels, track names, tempos and controller/program messages', () => {
	const document: MidiFileDocument = {
		sampleRate: 48_000,
		tempos: [{ frame: 0, bpm: 120 }, { frame: 48_000, bpm: 90 }],
		signatures: [{ frame: 0, numerator: 3, denominator: 4 }],
		tracks: [{ name: 'Piano 🎹', notes: [
			{ id: 'a', pitch: 60, channel: 0, velocity: 100, startFrame: 0, durationFrames: 24_000 },
			{ id: 'b', pitch: 64, channel: 1, velocity: 80, startFrame: 0, durationFrames: 96_000 },
		], events: [{ frame: 0, status: 0xc0, data: [40] }, { frame: 12_000, status: 0xb0, data: [64, 127] }] }],
	};
	const parsed = parseMidiFile(writeMidiFile(document), { sampleRate: 48_000 });
	const musicalTrack = parsed.tracks.find(track => track.notes.length > 0);
	assert.equal(musicalTrack?.name, 'Piano 🎹');
	assert.deepEqual(musicalTrack?.notes.map(({ id: _id, ...note }) => note), document.tracks[0]?.notes.map(({ id: _id, ...note }) => note));
	assert.deepEqual(musicalTrack?.events, document.tracks[0]?.events);
	assert.deepEqual(parsed.tempos.map(tempo => tempo.frame), document.tempos.map(tempo => tempo.frame));
	for (const [index, tempo] of parsed.tempos.entries()) assert.ok(Math.abs(tempo.bpm - document.tempos[index]!.bpm) < 0.0001);
	assert.deepEqual(parsed.signatures, document.signatures);
});

test('MIDI SMPTE division resolves elapsed time independently of tempo', () => {
	const parsed = parseMidiFile(smf([[0, 0x90, 60, 80, 0x83, 0x74, 0x80, 60, 0, 0, 255, 47, 0]], 0xe728), { sampleRate: 48_000 });
	assert.equal(parsed.tracks[0]?.notes[0]?.durationFrames, 24_000);
});

test('MIDI rejects truncated chunks, invalid running status, oversized delta times, and asynchronous type 2 files', () => {
	assert.throws(() => parseMidiFile(smf([[0, 60, 127, 0, 255, 47, 0]])), /running status/i);
	assert.throws(() => parseMidiFile(smf([[0x81, 0x81, 0x81, 0x81, 0, 255, 47, 0]])), /variable|delta/i);
	assert.throws(() => parseMidiFile(smf([[0, 255, 47, 0]]).subarray(0, 24)), /truncated/i);
	assert.throws(() => parseMidiFile(smf([[0, 255, 47, 0]], 480, 2)), /type 2|format 2/i);
});

test('MIDI preserves text/SysEx and pairs overlapping equal-pitch notes independently by channel', () => {
	const parsed = parseMidiFile(smf([[
		0, 0xf0, 3, 0x7d, 1, 0xf7,
		0, 0xff, 1, 2, 104, 105,
		0, 0x90, 60, 100, 0, 0x91, 60, 90,
		0x81, 0x70, 0x90, 60, 80,
		0x81, 0x70, 0x80, 60, 0,
		0x81, 0x70, 0x81, 60, 0,
		0x81, 0x70, 0x80, 60, 0,
		0, 0xff, 47, 0,
	]]));
	assert.deepEqual(parsed.tracks[0]?.notes.map(note => [note.channel, note.velocity, note.startFrame, note.durationFrames]), [
		[0, 100, 0, 24_000], [1, 90, 0, 36_000], [0, 80, 12_000, 36_000],
	]);
	const musicalTrack = parseMidiFile(writeMidiFile(parsed)).tracks.find(track => track.notes.length);
	assert.deepEqual(musicalTrack?.events, parsed.tracks[0]?.events);
});

test('MIDI validates SMPTE division even without notes and refuses unrepresentable export events', () => {
	assert.throws(() => parseMidiFile(smf([[0, 255, 47, 0]], 0xe100)), /SMPTE/i);
	const document: MidiFileDocument = { sampleRate: 48_000, tracks: [{ name: 'invalid', notes: [], events: [{ frame: 0, status: 0xb0, data: [64, 255] }] }], tempos: [], signatures: [] };
	assert.throws(() => writeMidiFile(document), /byte/i);
});
