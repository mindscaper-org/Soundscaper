/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

for (const tuple of [
	{ code: 24, ticks: 80, start: [0x87, 0x49], span: [0x81, 0x40], frame: 4038, duration: 800 },
	{ code: 29, ticks: 120, start: [0x81, 0x61], span: [0x83, 0x42], frame: 501, duration: 1001 },
]) test(`SMPTE ${tuple.code}fps exact half-sample points follow nearest sample policy`, async () => {
	const track = [...tuple.start, 0x90, 60, 100, ...tuple.span, 0x80, 60, 0, 0, 255, 47, 0];
	const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 256 - tuple.code, tuple.ticks,
		77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
	const file = new File([bytes], 'Film cue.mid');
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(await file.arrayBuffer(), { sampleRate: 8000 }));
	assert.deepEqual(readMidiClip(f.project().clips[0])?.notes.map(note => [note.startFrame, note.durationFrames]), [[tuple.frame, tuple.duration]]);
});
