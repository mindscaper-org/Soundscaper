/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('note-attached Allegro attributes refuse import before becoming global controls or dropping a key-implied note', async () => {
	for (const pitch of ['K60', 'P60']) {
		const file = new File([`#track 0 Piano\nT0 V0 ${pitch} -control7r:0.5\nK62\n`], 'Piano.gro');
		const text = await file.text();
		assert.throws(() => parseAllegroFile(text), /note-attached.*attribute|attribute.*note-attached/iu);
	}
});

test('separate channel updates and ordinary key-implied notes retain their timing', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseAllegroFile('#track 0 Piano\nT0 V0 -control7r:0.5\nK60\nK62\n', { sampleRate: 8000 }));
	assert.deepEqual(readMidiClip(f.project().clips[0])?.notes.map(note => [note.pitch, note.startFrame, note.durationFrames]), [
		[60, 0, 8000], [62, 8000, 8000],
	]);
});

test('Allegro refuses polyphonic pressure that native PortSMF would read as a phantom note', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Pressure',
		notes: [{ id: 'n', pitch: 60, channel: 0, velocity: 90, startFrame: 0, durationFrames: 8000 }],
		events: [{ frame: 4000, status: 0xa0, data: [60, 100] }],
	}] }), { sampleRate: 8000 }));
	await assert.rejects(f.service.exportFile('allegro'), /pressure|cannot be represented/iu);
	assert.equal(f.saves.length, 0);
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	assert.ok(parseMidiFile(bytes).tracks.some(track => track.events?.some(event => event.status === 0xa0)));
});
