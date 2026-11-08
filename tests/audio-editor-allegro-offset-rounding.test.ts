/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

// A 48 kHz source's three-sample note time plus three-sample track offset
// becomes exactly one sample in the receiving 8 kHz project.
const FRACTIONAL_OFFSET = `#offset 0.0000625
#track 0 Shifted
T0.0000625 -tempor:120
T0.0000625 V- -timesig_numr:6 -timesig_denr:8
T0.0000625 V- -keysigi:1 -modea:'major'
T0.0000625 V0 -control11r:0.5
T0.0000625 V0 P60 U0.5 L100
T0.0000625 V0 P64 U0.0001875 L100
`;

test('Allegro combines fractional track offsets with notes, endpoints, controls and conductor before sample rounding', async () => {
	const document = parseAllegroFile(FRACTIONAL_OFFSET, { sampleRate: 8000 });
	const f = midiServiceFixture();
	await f.service.importDocument(document);
	const clip = readMidiClip(f.project().clips[0]);
	assert.ok(clip);
	assert.deepEqual(clip.notes.map(note => [note.startFrame, note.durationFrames]), [[1, 4000], [1, 2]]);
	assert.equal(clip.interchange?.events.find(event => event.status === 0xb0)?.frame, 1);
	assert.equal(clip.interchange?.events.find(event => event.metaType === 89)?.frame, 1);
	assert.equal(clip.interchange?.tempos.find(tempo => tempo.bpm === 120)?.frame, 1);
	assert.equal(clip.interchange?.signatures.find(signature => signature.numerator === 6)?.frame, 1);
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	assert.deepEqual(parseMidiFile(bytes, { sampleRate: 8000 }).tracks.find(track => track.notes.length)?.notes.map(note =>
		[note.startFrame, note.durationFrames]), [[1, 4000], [1, 2]]);
});

test('fractional negative offsets quantizing to the origin yield canonical zero coordinates', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseAllegroFile('#offset -0.00003125\nT0 V0 -control11r:0.5\nT0 V0 P60 U0.5\n', { sampleRate: 8000 }));
	const clip = readMidiClip(f.project().clips[0]);
	assert.ok(clip);
	assert.equal(clip.notes[0]?.startFrame, 0);
	assert.equal(clip.interchange?.events[0]?.frame, 0);
});
