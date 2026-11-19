/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { routeMidiImportControls } from '../src/common/editor/midi-file-import-channel-routing.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import type { MidiFileTrack } from '../src/common/editor/midi-file-types.ts';

const note = { id: 'n', pitch: 69, channel: 1, velocity: 100, startFrame: 0, durationFrames: 8000 };
for (const notes of [[], [{ ...note, id: 'donor', channel: 0 }]]) {
	test(`a foreign uniquely owned expression channel reaches its audible owner with donor notes=${notes.length}`, async () => {
		const f = midiServiceFixture();
		const input = writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [
			{ name: 'Donor', notes, events: [{ frame: 0, status: 177, data: [7, 0] }] },
			{ name: 'Peer', notes: [note] },
		] });
		const created = await f.service.importDocument(parseMidiFile(input, { sampleRate: 8000 }));
		assert.equal(created.length, notes.length ? 2 : 1);
		const peer = f.project().clips.find(clip => clip.title === 'Peer'); assert.ok(peer);
		const samples = f.pcm.get(String(peer.sourceId)); assert.ok(samples);
		assert.ok(samples[0]!.slice(1000, 3000).every(value => value === 0), 'the sole channel1 owner must receive its original volume0');
	});
}

test('routing foreign controls preserves donor notes, its own controls and unrelated metadata exactly', () => {
	const local = { frame: 0, status: 176, data: [7, 100] };
	const foreign = { frame: 1000, status: 225, data: [0, 96] };
	const text = { frame: 500, status: 255, metaType: 1, data: [65] };
	const tracks: readonly MidiFileTrack[] = [
		{ name: 'Donor', notes: [{ ...note, channel: 0 }], events: [local, text, foreign] },
		{ name: 'Peer', notes: [note] },
	];
	const before = structuredClone(tracks), output = routeMidiImportControls(tracks);
	assert.deepEqual(output[0]?.events, [local, text]);
	assert.deepEqual(output[1]?.events, [foreign]);
	assert.strictEqual(output[0]?.notes, tracks[0]?.notes);
	assert.strictEqual(output[1]?.notes, tracks[1]?.notes);
	assert.deepEqual(tracks, before);
});

test('foreign controls stay on the donor when the receiving channel has multiple note owners', () => {
	const tracks: readonly MidiFileTrack[] = [
		{ name: 'Donor', notes: [{ ...note, channel: 0 }], events: [{ frame: 0, status: 177, data: [7, 0] }] },
		{ name: 'Peer1', notes: [note] }, { name: 'Peer2', notes: [{ ...note, id: 'other' }] },
	];
	assert.deepEqual(routeMidiImportControls(tracks), tracks);
});

test('a note-bearing donor cannot send its expression to another MIDI port', () => {
	const tracks: readonly MidiFileTrack[] = [
		{ name: 'Donor', notes: [{ ...note, channel: 0 }], events: [{ frame: 0, status: 177, data: [7, 0] }] },
		{ name: 'Peer', notes: [{ ...note, midiPort: 1 }], noteDestinations: [{ channel: 1, port: 1 }],
			events: [{ frame: 0, status: 255, metaType: 33, data: [1] }] },
	];
	assert.deepEqual(routeMidiImportControls(tracks), tracks);
});

test('an SMF channel control reaches its port before the note track selects it', async () => {
	const f = midiServiceFixture();
	const port = (frame: number, id: number) => ({ frame, status: 255, metaType: 33, data: [id] });
	const control = { frame: 200, status: 177, data: [7, 0] };
	const local = { frame: 400, status: 177, data: [7, 100] };
	const input = writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [
		{ name: 'Port setup', notes: [], events: [port(0, 2), control] },
		{ name: 'Melody', notes: [{ ...note, startFrame: 800, midiPort: 2 }], events: [local, port(800, 2)] },
	] });
	const document = parseMidiFile(input, { sampleRate: 8000 });
	await f.service.importDocument(document);
	const clip = f.project().clips.find(candidate => candidate.title === 'Melody');
	assert.ok(clip);
	const samples = f.pcm.get(String(clip.sourceId));
	assert.ok(samples);
	assert.ok(samples[0]!.slice(1000, 3000).every(value => value === 0), 'the early port-2 volume change must mute the melody');
	const melody = routeMidiImportControls(document.tracks).find(track => track.name === 'Melody');
	assert.deepEqual(melody?.events, [port(200, 2), control, port(200, 0), local, port(800, 2)]);
	await f.service.exportFile('midi');
	const exported = parseMidiFile(f.saves[0]?.bytes as Uint8Array, { sampleRate: 8000 });
	const reopened = midiServiceFixture();
	await reopened.service.importDocument(exported);
	const reopenedClip = reopened.project().clips.find(candidate => candidate.title === 'Melody');
	assert.ok(reopenedClip);
	assert.deepEqual(reopened.pcm.get(String(reopenedClip.sourceId)), samples);
});
