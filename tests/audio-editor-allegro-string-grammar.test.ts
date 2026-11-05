/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

test('Allegro quoted strings use native literal escapes instead of JSON escapes', async () => {
	const file = new File(['#track 0 Lyrics\nT0 V- -lyrics:"Line one\\nLine two\\tEnd"\nT0 V0 P60 U1\n'], 'Lyrics.gro');
	const f = midiServiceFixture();
	await f.service.importDocument(parseAllegroFile(await file.text(), { sampleRate: 8000 }));
	const lyric = readMidiClip(f.project().clips[0])?.interchange?.events.find(event => event.metaType === 5);
	assert.ok(lyric);
	assert.equal(new TextDecoder().decode(Uint8Array.from(lyric.data)), 'Line onenLine twotEnd');
});

test('a literal tab inside a native Allegro quoted lyric remains valid', () => {
	const document = parseAllegroFile('#track 0 Lyrics\nT0 V- -lyrics:"Verse\tword"\nT0 V0 P60 U1\n', { sampleRate: 8000 });
	const lyric = document.tracks[0]?.events?.find(event => event.metaType === 5); assert.ok(lyric);
	assert.equal(new TextDecoder().decode(Uint8Array.from(lyric.data)), 'Verse\tword');
});

test('Allegro delivery keeps native literal tabs, quotes, backslashes and backslash-n text', async () => {
	const text = 'Verse\tword "quoted" \\n literal';
	const f = await imported(text);
	await f.service.exportFile('allegro');
	const delivered = f.saves[0]?.text; assert.equal(typeof delivered, 'string');
	assert.ok(String(delivered).includes('-lyrics:"Verse\tword \\"quoted\\" \\\\n literal"'));
	const lyric = parseAllegroFile(String(delivered), { sampleRate: 8000 }).tracks[0]?.events?.find(event => event.metaType === 5);
	assert.ok(lyric);
	assert.equal(new TextDecoder().decode(Uint8Array.from(lyric.data)), text);
});

test('Allegro refuses literal line breaks and NUL in retained MIDI text before saving lossy output', async () => {
	for (const text of ['Verse\nRefrain', 'Verse\rRefrain', 'Verse\0Refrain']) {
		const f = await imported(text);
		await assert.rejects(f.service.exportFile('allegro'), /cannot be represented in Allegro/u);
		assert.equal(f.saves.length, 0);
		await f.service.exportFile('midi');
		const bytes = f.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
		const lyric = parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.events ?? []).find(event => event.metaType === 5);
		assert.ok(lyric);
		assert.equal(new TextDecoder().decode(Uint8Array.from(lyric.data)), text);
	}
});

async function imported(text: string) {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Lyrics',
		notes: [{ id: 'note', channel: 0, pitch: 60, velocity: 100, startFrame: 0, durationFrames: 4000 }],
		events: [{ frame: 0, status: 255, metaType: 5, data: [...new TextEncoder().encode(text)] }] }] }), { sampleRate: 8000 }));
	return f;
}

test('unknown Allegro backslash escapes retain their following literal character', () => {
	const document = parseAllegroFile('T0 -texts:"Unknown\\q\\u0041"\nT0 V0 P60 U1\n');
	const event = document.tracks[0]?.events?.[0]; assert.ok(event);
	assert.equal(new TextDecoder().decode(Uint8Array.from(event.data)), 'Unknownqu0041');
});
