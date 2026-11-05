/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

async function imported(name: string) {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name,
		notes: [{ id: 'n', pitch: 60, channel: 0, velocity: 100, startFrame: 0, durationFrames: 4000 }] }] }), { sampleRate: 8000 }));
	assert.equal(f.project().tracks[0]?.name, name);
	return f;
}

test('Allegro export refuses a multiline admitted track name before silently changing it', async () => {
	for (const name of ['Piano\nVerse', 'Piano\rVerse']) {
		const f = await imported(name);
		await assert.rejects(f.service.exportFile('allegro'), /track name.*Allegro|Allegro.*track name/u);
		assert.equal(f.saves.length, 0);
		await f.service.exportFile('midi');
		const bytes = f.saves[0]?.bytes;
		assert.ok(bytes instanceof Uint8Array);
		assert.ok(parseMidiFile(bytes).tracks.some(track => track.name === name), 'MIDI retains the original text');
	}
});

test('Allegro delivery keeps ordinary Unicode track names unchanged', async () => {
	const f = await imported('Élodie — Piano 東京');
	await f.service.exportFile('allegro');
	assert.equal(parseAllegroFile(String(f.saves[0]?.text)).tracks[0]?.name, f.project().tracks[0]?.name);
});
