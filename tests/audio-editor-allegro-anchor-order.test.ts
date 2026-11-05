/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('a consistent Allegro beat-anchor map imports independently of numeric declaration order', async () => {
	for (const anchors of ['T2 -beatr:4\nT1 -beatr:2', 'T1 -beatr:2\nT2 -beatr:4']) {
		const file = new File([`#track 0 Piano\n${anchors}\nTQ1 V0 P60 Q\n`], 'Anchored.gro');
		const parsed = parseAllegroFile(await file.text(), { sampleRate: 8000 });
		const f = midiServiceFixture();
		await f.service.importDocument(parsed);
		assert.deepEqual(readMidiClip(f.project().clips[0])?.notes.map(note => [note.startFrame, note.durationFrames]), [[4000, 4000]]);
		await f.service.exportFile('midi');
		const bytes = f.saves[0]?.bytes;
		assert.ok(bytes instanceof Uint8Array);
		assert.deepEqual(parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.notes.map(note =>
			[note.startFrame, note.durationFrames])), [[4000, 4000]]);
	}
});

test('Allegro anchor normalization retains source-order replacement at equal times and rejects inconsistent clocks', () => {
	const replaced = parseAllegroFile('T2 -beatr:4\nT1 -beatr:1\nT1 -beatr:2\nTQ1 P60 Q\n', { sampleRate: 8000 });
	assert.equal(replaced.tracks[0]?.notes[0]?.startFrame, 4000);
	assert.throws(() => parseAllegroFile('T2 -beatr:1\nT1 -beatr:2\nTQ1 P60 Q\n'), /anchor/iu);
	assert.throws(() => parseAllegroFile('T0 -beatr:1\nTQ1 P60 Q\n'), /anchor/iu);
});
