/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('right-trimming a multipart SysEx refuses incomplete MIDI output before save', async () => {
	const f = midiServiceFixture();
	const document = parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Patch and note',
		durationFrames: 8000, notes: [{ id: 'n', pitch: 60, channel: 0, velocity: 90, startFrame: 6000, durationFrames: 2000 }],
		events: [{ frame: 0, status: 0xf0, data: [0x43, 0x12, 0] }, { frame: 4000, status: 0xf7, data: [0x43, 0x12, 0, 0xf7] }] }] }), { sampleRate: 8000 });
	const created = await f.service.importDocument(document);
	await f.service.exportFile('midi');
	assert.equal(f.saves.length, 1, 'the original complete multipart message is exportable');
	await f.service.resizeClip(created[0]!.clipId, { timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 2000 });
	await assert.rejects(f.service.exportFile('midi'), /multipart.*[Ss]ystem [Ee]xclusive|[Ss]ystem [Ee]xclusive.*incomplete/u);
	assert.equal(f.saves.length, 1, 'no truncated system message reaches the save destination');
});

test('standalone F7 escape packets remain exportable without an F0 opener', () => {
	const document = parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Escapes', notes: [],
		events: [{ frame: 0, status: 0xf7, data: [0xf8] }, { frame: 4000, status: 0xf7, data: [] }] }] }));
	assert.deepEqual(document.tracks.find(track => track.name === 'Escapes')?.events, [{ frame: 0, status: 0xf7, data: [0xf8] }]);
});
