/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import type { MidiFileDocument } from '../src/common/editor/midi-file-types.ts';

const note = { id: 'first', pitch: 60, channel: 0, velocity: 100, startFrame: 0, durationFrames: 4000 };
const nested = { ...note, id: 'nested', velocity: 60, startFrame: 1000, durationFrames: 1000 };
const values = (document: MidiFileDocument) => document.tracks.flatMap(track => track.notes)
	.map(({ startFrame, durationFrames, velocity, releaseVelocity, channel }) => ({ startFrame, durationFrames, velocity,
		releaseVelocity: releaseVelocity ?? 0, channel }));

function document(notes: MidiFileDocument['tracks'][number]['notes']): MidiFileDocument {
	return { sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [{ name: 'Lead', notes }] };
}

test('ordinary authored nested same-key notes refuse MIDI publication and remain available as Allegro', async () => {
	const fixture = midiServiceFixture();
	const { clipId } = await fixture.service.addTrack();
	await fixture.service.addNote(clipId, note);
	await fixture.service.addNote(clipId, nested);
	const before = structuredClone(fixture.project());
	await assert.rejects(fixture.service.exportFile('midi'), /MIDI.*overlapping.*same.*key.*Allegro/u);
	assert.equal(fixture.saves.length, 0, 'no misleading MIDI file is published');
	assert.deepEqual(fixture.project(), before);
	await fixture.service.exportFile('allegro');
	assert.equal(fixture.saves.length, 1);
	const saved = fixture.saves[0]?.text;
	assert.equal(typeof saved, 'string');
	assert.deepEqual(values(parseAllegroFile(String(saved), { sampleRate: 8000 })), values(document([note, nested])));
});

test('same-key overlaps whose ends follow their onsets retain independent velocity and durations', () => {
	const input = document([note, { ...nested, durationFrames: 5000 }]);
	assert.deepEqual(values(parseMidiFile(writeMidiFile(input), { sampleRate: 8000 })), values(input));
});

test('equal-onset nested notes refuse only when authored order gives them different release endpoints', () => {
	assert.throws(() => writeMidiFile(document([note, { ...nested, startFrame: 0 }])), /overlapping/u);
	const input = document([{ ...nested, startFrame: 0 }, note]);
	assert.deepEqual(values(parseMidiFile(writeMidiFile(input), { sampleRate: 8000 })), values(input));
});

test('equal-end same-key notes keep matching release velocities or refuse their reassignment', () => {
	const earlier = { ...note, releaseVelocity: 81 };
	const later = { ...nested, durationFrames: 3000, releaseVelocity: 40 };
	assert.throws(() => writeMidiFile(document([later, earlier])), /overlapping/u);
	for (const notes of [[earlier, later], [{ ...later, releaseVelocity: 81 }, earlier]]) {
		const input = document(notes);
		const compare = (input: MidiFileDocument) => values(input).sort((a, b) => a.startFrame - b.startFrame);
		assert.deepEqual(compare(parseMidiFile(writeMidiFile(input), { sampleRate: 8000 })), compare(input));
	}
});

test('independent pitches, channels and ports are not treated as one overlapping key', () => {
	for (const second of [{ ...nested, pitch: 61 }, { ...nested, channel: 1 }, { ...nested, midiPort: 1 }]) {
		const input = document([{ ...note, midiPort: 0 }, second]);
		assert.deepEqual(values(parseMidiFile(writeMidiFile(input), { sampleRate: 8000 })), values(input));
	}
});
