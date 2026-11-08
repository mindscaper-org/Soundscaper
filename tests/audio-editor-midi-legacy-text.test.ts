/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { parseAllegroFile, writeAllegroFile } from '../src/common/editor/allegro-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('extended-byte SMF track names and text survive import and MIDI or Allegro re-export', async () => {
	const text = [67, 97, 102, 0xe9];
	const events = [0, 0xff, 3, 4, ...text, 0, 0xff, 2, 4, ...text,
		0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0];
	const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
	const document = parseMidiFile(bytes, { sampleRate: 8000 });
	assert.equal(document.tracks[0]?.name, 'Café');
	const f = midiServiceFixture();
	await f.service.importDocument(document);
	assert.equal(f.project().tracks[0]?.name, 'Café');
	assert.equal(parseMidiFile(writeMidiFile(document)).tracks.find(track => track.notes.length)?.name, 'Café');
	const allegro = parseAllegroFile(writeAllegroFile(document));
	assert.equal(allegro.tracks[0]?.name, 'Café');
	assert.equal(new TextDecoder().decode(Uint8Array.from(allegro.tracks[0]!.events![0]!.data)), 'Café');
});

test('SMF UTF-8 text remains exact when decoding legacy text is supported', () => {
	for (const name of ['Café', '東京', 'Ensemble 🎹']) {
		const document = parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [],
			tracks: [{ name, notes: [{ id: 'n', pitch: 60, velocity: 90, channel: 0, startFrame: 0, durationFrames: 8000 }] }] }));
		assert.equal(document.tracks.find(track => track.notes.length)?.name, name);
	}
});
