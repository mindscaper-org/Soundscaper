/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('an explicit Allegro final tempo continues beyond the last absolute beat anchor', async () => {
	for (const anchors of ['T2 -beatr:4', 'T2 -beatr:4\nT4 -beatr:8']) {
		const beat = anchors.includes('T4') ? 9 : 5;
		const startFrame = anchors.includes('T4') ? 40_000 : 24_000;
		const file = new File([`#track 0 Piano\nT0 -tempor:60\n${anchors}\nTQ${beat} V0 P60 Q\n`], 'Anchored.gro');
		const f = midiServiceFixture();
		await f.service.importDocument(parseAllegroFile(await file.text(), { sampleRate: 8000 }));
		assert.deepEqual(readMidiClip(f.project().clips[0])?.notes.map(note => [note.startFrame, note.durationFrames]), [[startFrame, 8000]]);
		await f.service.exportFile('midi');
		const bytes = f.saves[0]?.bytes;
		assert.ok(bytes instanceof Uint8Array);
		assert.deepEqual(parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.notes.map(note =>
			[note.startFrame, note.durationFrames])), [[startFrame, 8000]]);
	}
});

test('a tempo declared at the final anchor still determines its outgoing segment', () => {
	const parsed = parseAllegroFile('T0 -tempor:60\nT2 -beatr:4\nT2 -tempor:120\nTQ5 P60 Q\n', { sampleRate: 8000 });
	assert.deepEqual(parsed.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[20_000, 4000]]);
});
