/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('type-1 MIDI note releases on another synchronous track end the originating note', async () => {
	const document = parseMidiFile(file(0, 0), { sampleRate: 8000 });
	assert.equal(document.tracks[0]?.notes[0]?.durationFrames, 2000);
	assert.equal(document.tracks[0]?.notes[0]?.releaseVelocity, 81);
	const reopened = parseMidiFile(writeMidiFile(document), { sampleRate: 8000 });
	assert.equal(reopened.tracks.find(track => track.notes.length)?.notes[0]?.durationFrames, 2000);
	const f = midiServiceFixture();
	await f.service.importDocument(document);
	const pcm = [...f.pcm.values()][0]![0]!;
	assert.ok(pcm.subarray(100, 1900).some(value => value !== 0));
	assert.ok(pcm.subarray(3000, 4000).every(value => value === 0));
});

test('a release sent to a different MIDI port cannot end another destination’s note', () => {
	const document = parseMidiFile(file(0, 1), { sampleRate: 8000 });
	assert.equal(document.tracks[0]?.notes[0]?.durationFrames, 8000);
});

test('channel-mode key releases on another track close keys on the same destination', () => {
	for (const controller of [120, 123, 124, 125, 126, 127]) {
		const bytes = file(0, 0);
		const release = bytes.indexOf(0x80, 35);
		assert.ok(release > 0);
		bytes[release] = 0xb0; bytes[release + 1] = controller; bytes[release + 2] = 0;
		assert.equal(parseMidiFile(bytes, { sampleRate: 8000 }).tracks[0]?.notes[0]?.durationFrames, 2000);
	}
});

test('MIDI destination changes are resolved at each note and release instead of once per track', () => {
	const note = [0, 0xff, 0x21, 1, 0, 0, 0x90, 60, 100,
		100, 0xff, 0x21, 1, 1, 100, 0x80, 60, 0, 0x85, 0x78, 0xff, 0x2f, 0];
	const release = [0, 0xff, 0x21, 1, 0, 0x82, 0x2c, 0x80, 60, 81, 0x85, 0x14, 0xff, 0x2f, 0];
	const document = parseMidiFile(tracks(note, release), { sampleRate: 8000 });
	assert.equal(document.tracks[0]?.notes[0]?.durationFrames, 2500);
});

function file(notePort: number, releasePort: number): Uint8Array {
	const note = [0, 0xff, 0x21, 1, notePort, 0, 0x90, 60, 100, 0x87, 0x40, 0xff, 0x2f, 0];
	const release = [0, 0xff, 0x21, 1, releasePort, 0x81, 0x70, 0x80, 60, 81, 0x85, 0x50, 0xff, 0x2f, 0];
	return tracks(note, release);
}

function tracks(note: readonly number[], release: readonly number[]): Uint8Array {
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 0, 2, 1, 224,
		77, 84, 114, 107, 0, 0, 0, note.length, ...note,
		77, 84, 114, 107, 0, 0, 0, release.length, ...release]);
}
