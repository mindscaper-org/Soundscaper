/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { routeMidiImportControls } from '../src/common/editor/controller/track-audio/internal/midi-import-channel-routing.ts';
import type { MidiFileTrack } from '../src/common/editor/midi-file-types.ts';

const note = { id: 'note', pitch: 60, startFrame: 0, durationFrames: 8000, velocity: 100, channel: 0 };

test('MIDI import routes only uniquely owned expression channels and retains other auxiliary events', () => {
	const routedVolume = { frame: 0, status: 0xb0, data: [7, 0] };
	const routedBend = { frame: 1000, status: 0xe0, data: [0, 96] };
	const retained = [
		{ frame: 0, status: 0xb1, data: [11, 40] },
		{ frame: 0, status: 0xb2, data: [7, 80] },
		{ frame: 0, status: 0xb0, data: [0, 1] },
		{ frame: 0, status: 0xb0, data: [32, 2] },
		{ frame: 0, status: 0xc0, data: [10] },
		{ frame: 0, status: 0xff, metaType: 1, data: [65] },
	];
	const tracks: readonly MidiFileTrack[] = [
		{ name: 'Controls', notes: [], events: [routedVolume, ...retained, routedBend] },
		{ name: 'Melody', notes: [note], events: [{ frame: 0, status: 0xb0, data: [7, 100] }] },
		{ name: 'Shared 1', notes: [{ ...note, channel: 2 }] },
		{ name: 'Shared 2', notes: [{ ...note, channel: 2 }] },
	];
	const before = structuredClone(tracks);
	const result = routeMidiImportControls(tracks);
	assert.deepEqual(result[0]?.events, retained);
	assert.deepEqual(result[1]?.events, [routedVolume, ...tracks[1]!.events!, routedBend]);
	assert.strictEqual(result[2], tracks[2]);
	assert.strictEqual(result[3], tracks[3]);
	assert.deepEqual(result.map(track => track.name), tracks.map(track => track.name));
	assert.deepEqual(tracks, before);
});

test('MIDI import leaves controls on note-bearing tracks and never combines their notes', () => {
	const tracks: readonly MidiFileTrack[] = [
		{ name: 'First', notes: [note], events: [{ frame: 0, status: 0xb0, data: [7, 0] }] },
		{ name: 'Second', notes: [{ ...note, id: 'second' }] },
	];
	const result = routeMidiImportControls(tracks);
	assert.deepEqual(result, tracks);
	assert.strictEqual(result[0], tracks[0]);
	assert.strictEqual(result[1], tracks[1]);
});
