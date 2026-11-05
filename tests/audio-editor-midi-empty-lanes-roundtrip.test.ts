/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';

for (const populated of [false, true]) test(`authored empty MIDI lanes survive export/import with ${populated ? 'mixed' : 'empty'} content`, async () => {
	const first = midiServiceFixture();
	const strings = await first.service.addTrack(), drums = await first.service.addTrack();
	first.apply({ type: 'track/update', trackId: strings.trackId, changes: { name: 'Strings' } });
	first.apply({ type: 'track/update', trackId: drums.trackId, changes: { name: 'Drums' } });
	if (populated) await first.service.addNote(strings.clipId,
		{ id: 'melody', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 2000 });
	assert.ok(validateAudioEditorProjectV17(first.project()));
	await first.service.exportFile('midi');
	const bytes = first.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const document = parseMidiFile(bytes, { sampleRate: 8000 });
	assert.equal(document.tracks[0]?.conductorOnly, true);
	assert.deepEqual(document.tracks.slice(1).map(track => track.name), ['Strings', 'Drums']);
	const before = structuredClone(document);
	const second = midiServiceFixture(); await second.service.importDocument(document);
	assert.deepEqual(second.project().tracks.map(track => track.name), ['Strings', 'Drums']);
	assert.deepEqual(second.project().clips.map(clip => clip.durationFrames), first.project().clips.map(clip => clip.durationFrames));
	assert.deepEqual(document, before);
});

test('a file without authored timing state never invents an empty conductor lane', async () => {
	const document = parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [
		{ name: 'Strings', notes: [{ id: 'n', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 2000 }] },
		{ name: 'Drums', notes: [] },
	] }), { sampleRate: 8000 });
	const f = midiServiceFixture(); await f.service.importDocument(document);
	assert.deepEqual(f.project().tracks.map(track => track.name), ['Strings', 'Drums']);
});
