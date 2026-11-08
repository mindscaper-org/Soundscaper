/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('left trimming retains independently held controller and program state for each MIDI port', async () => {
	const f = midiServiceFixture();
	const input = writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Two ports',
		notes: [{ id: 'key', pitch: 60, channel: 0, velocity: 100, startFrame: 8000, durationFrames: 8000, midiPort: 0 }], events: [
			{ frame: 0, status: 0xb0, data: [7, 0] }, { frame: 0, status: 0xc0, data: [40] },
			{ frame: 1000, status: 255, metaType: 0x21, data: [1] },
			{ frame: 1000, status: 0xb0, data: [7, 127] }, { frame: 1000, status: 0xc0, data: [16] },
			{ frame: 8000, status: 255, metaType: 0x21, data: [0] },
		] }] });
	const created = await f.service.importDocument(parseMidiFile(input, { sampleRate: 8000 }));
	await f.service.resizeClip(created[0]!.clipId, { timelineStartFrame: 0, sourceStartFrame: 4000, durationFrames: 16_000 });
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	const track = parseMidiFile(bytes, { sampleRate: 8000 }).tracks.find(value => value.notes.length)!;
	let port = 0;
	const volumes = new Map<number, number>(), programs = new Map<number, number>();
	for (const event of track.events ?? []) {
		if (event.metaType === 0x21) port = event.data[0]!;
		if (event.status === 0xb0 && event.data[0] === 7) volumes.set(port, event.data[1]!);
		if (event.status === 0xc0) programs.set(port, event.data[0]!);
	}
	assert.deepEqual([...volumes], [[0, 0], [1, 127]]);
	assert.deepEqual([...programs], [[0, 40], [1, 16]]);
	assert.equal(track.notes[0]?.midiPort, 0);
});

test('a pedal on another port cannot invent a sustained note after trimming past its key release', async () => {
	const f = midiServiceFixture();
	const bytes = writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Independent pedal', durationFrames: 16_000,
		notes: [{ id: 'key', pitch: 60, channel: 0, velocity: 100, startFrame: 0, durationFrames: 4000, midiPort: 0 }], events: [
			{ frame: 0, status: 255, metaType: 0x21, data: [1] }, { frame: 0, status: 0xb0, data: [64, 127] },
			{ frame: 0, status: 255, metaType: 0x21, data: [0] },
		] }] });
	const created = await f.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	await f.service.resizeClip(created[0]!.clipId, { timelineStartFrame: 0, sourceStartFrame: 8000, durationFrames: 8000 });
	await f.service.exportFile('midi');
	const output = f.saves[0]?.bytes;
	assert.ok(output instanceof Uint8Array);
	assert.equal(parseMidiFile(output, { sampleRate: 8000 }).tracks.flatMap(track => track.notes).length, 0);
});
