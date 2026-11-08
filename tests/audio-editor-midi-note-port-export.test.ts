/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

function file(events: readonly number[]): Uint8Array<ArrayBuffer> {
	const track = [...events, 0, 255, 47, 0];
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, track.length >> 8, track.length & 255, ...track]);
}

test('MIDI export retains a note destination when a port selector follows its onset at the same tick', async () => {
	const original = parseMidiFile(file([0, 0x90, 69, 100, 0, 255, 0x21, 1, 1,
		0x83, 0x60, 0xb0, 7, 80, 0, 255, 0x21, 1, 0, 0, 0x80, 69, 0]), { sampleRate: 8000 });
	assert.deepEqual(original.tracks[0]?.noteDestinations, [{ channel: 0, port: 0 }]);
	const f = midiServiceFixture();
	await f.service.importDocument(original);
	assert.equal(readMidiClip(f.project().clips[0])?.notes[0]?.midiPort, 0);
	const native: unknown = JSON.parse(JSON.stringify(f.project()));
	assert.ok(validateAudioEditorProjectV17(native));
	assert.equal(readMidiClip(native.clips[0])?.notes[0]?.midiPort, 0, 'native save/reopen retains authored routing');
	assert.equal(midiDocumentFromProject({ ...native }).tracks.find(track => track.notes.length)?.notes[0]?.midiPort, 0);
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	const track = parseMidiFile(bytes, { sampleRate: 8000 }).tracks.find(value => value.notes.length)!;
	assert.deepEqual(track.noteDestinations, original.tracks[0]?.noteDestinations);
	assert.equal(track.notes[0]?.durationFrames, 4000);
	let port = 0;
	for (const event of track.events ?? []) {
		if (event.metaType === 0x21) port = event.data[0]!;
		if (event.status === 0xb0 && event.data[0] === 7) assert.equal(port, 1, 'note bracketing restores the original controller destination');
	}
});

test('a same-frame panic and retrigger retain their distinct authored ports', () => {
	const original = parseMidiFile(file([0, 0xb0, 64, 127, 0, 0x90, 69, 100, 0, 0xb0, 120, 0,
		0, 255, 0x21, 1, 1, 0, 0x90, 69, 90, 0x83, 0x60, 0x80, 69, 0]), { sampleRate: 8000 });
	const track = parseMidiFile(writeMidiFile(original), { sampleRate: 8000 }).tracks.find(value => value.notes.length)!;
	assert.deepEqual(track.notes.map(note => [note.velocity, note.midiPort, note.durationFrames, Boolean(note.onsetStop)]),
		[[100, 0, 1, true], [90, 1, 4000, false]]);
});

test('overlapping same-pitch notes on different ports retain both destinations and releases', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(file([0, 0x90, 69, 100, 0, 255, 0x21, 1, 1, 0, 0x90, 69, 90,
		0x83, 0x60, 0x80, 69, 0, 0, 255, 0x21, 1, 0, 0, 0x80, 69, 0]), { sampleRate: 8000 }));
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	const track = parseMidiFile(bytes, { sampleRate: 8000 }).tracks.find(value => value.notes.length)!;
	assert.deepEqual(track.notes.map(note => [note.velocity, note.midiPort, note.durationFrames]), [[100, 0, 4000], [90, 1, 4000]]);
});

test('MIDI export counts injected port selectors against the existing raw event limit', () => {
	const notes = Array.from({ length: 50_000 }, (_, index) => ({ id: `n${index}`, pitch: 60, channel: 0, velocity: 90,
		startFrame: index * 2, durationFrames: 1, midiPort: 0 }));
	assert.throws(() => writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Ports', notes,
		events: [{ frame: 0, status: 255, metaType: 0x21, data: [1] }] }] }), /reader event limit/iu);
});
