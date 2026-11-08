/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('an Allegro tempo before a later beat anchor retains its established interior clock boundary', async () => {
	const file = new File(['#track 0 Mixed clock\nT0 -tempor:60\nT1 -tempor:60\nT2 -beatr:4\nTQ5 V0 P60 Q\n'], 'Mixed clock.gro');
	const f = midiServiceFixture();
	const document = parseAllegroFile(await file.text(), { sampleRate: 8000 });
	await f.service.importDocument(document);
	assert.deepEqual(readMidiClip(f.project().clips[0])?.notes.map(note => [note.startFrame, note.durationFrames]), [[24_000, 8000]]);
	assert.deepEqual(document.tempos, [{ frame: 0, bpm: 60 }, { frame: 8000, bpm: 180 }, { frame: 16_000, bpm: 60 }]);
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	assert.deepEqual(parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.notes.map(note =>
		[note.startFrame, note.durationFrames])), [[24_000, 8000]]);
});

test('multiple Allegro interior tempo nodes retain the beats established before the next anchor', () => {
	const document = parseAllegroFile('T0 -tempor:60\nT1 -tempor:120\nT2 -tempor:60\nT3 -beatr:6\nTQ7 P60 Q\n', { sampleRate: 8000 });
	assert.deepEqual(document.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[32_000, 8000]]);
	assert.deepEqual(document.tempos, [{ frame: 0, bpm: 60 }, { frame: 8000, bpm: 120 },
		{ frame: 16_000, bpm: 180 }, { frame: 24_000, bpm: 60 }]);
});

test('Allegro refuses retroactive mixed-clock mutations that would move an existing anchor', () => {
	for (const declarations of ['T0 -tempor:60\nT2 -beatr:4\nT1 -tempor:60', 'T0 -tempor:60\nT2 -tempor:60\nT1 -beatr:2']) {
		assert.throws(() => parseAllegroFile(`${declarations}\nTQ5 P60 Q\n`, { sampleRate: 8000 }), /retroactive.*clock|clock.*retroactive/iu);
	}
});
