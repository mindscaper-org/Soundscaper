/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { parseAllegroFile, writeAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

// Audacity 3.7.7 ImportMIDI.cpp -> NoteTrack::ExportAllegro preserves raw SMF
// extended text through its bundled PortSMF reader and writer. Exact native output.
const nativeAllegro = '#offset 0\n#track 0 Caf\xe9\nT0.0000 -tempor:100\nT0.0000 V- -copyrights:"Caf\xe9"\nT0.0000 V0 K60 P60 U0.6000 L90\n';
const legacyBytes = Uint8Array.from(nativeAllegro, character => character.charCodeAt(0));

for (const browserFile of [true, false]) test(`legacy Allegro text survives ${browserFile ? 'browser File' : 'byte-only port'} import and native/MIDI/Allegro roundtrips`, async () => {
	const fixture = midiServiceFixture();
	const route = createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('Allegro must use MIDI import') },
		async () => fixture.service).importFiles;
	const file = browserFile ? new File([legacyBytes], 'Cafe.gro')
		: { name: 'Cafe.gro', arrayBuffer: async () => legacyBytes.slice().buffer };
	await route([file]);
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	assert.equal(fixture.project().tracks[0]?.name, 'Café');
	const saved: unknown = JSON.parse(JSON.stringify(fixture.project()));
	assert.ok(validateAudioEditorProjectV17(saved));
	assert.ok(saved && typeof saved === 'object' && 'tracks' in saved && Array.isArray(saved.tracks)
		&& 'clips' in saved && Array.isArray(saved.clips));
	assert.equal(saved.tracks[0]?.name, 'Café');
	const data = readMidiClip(saved.clips[0]);
	assert.ok(data);
	assert.equal(new TextDecoder().decode(Uint8Array.from(data.interchange!.events[0]!.data)), 'Café');
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	assert.equal(parseMidiFile(bytes).tracks.find(track => track.notes.length)?.name, 'Café');
	await fixture.service.exportFile('allegro');
	assert.equal(parseAllegroFile(String(fixture.saves[1]?.text)).tracks[0]?.name, 'Café');
});

test('Allegro import retains valid UTF-8 and text-only ports', async () => {
	for (const textOnly of [false, true]) {
		const fixture = midiServiceFixture();
		const route = createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('Allegro must use MIDI import') },
			async () => fixture.service).importFiles;
		const text = writeAllegroFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: '東京 🎹 Café',
			notes: [{ id: 'n', startFrame: 0, durationFrames: 4000, pitch: 60, velocity: 90, channel: 0 }] }] });
		await route([textOnly ? { name: 'UTF8.gro', text: async () => text } : new File([text], 'UTF8.gro')]);
		assert.equal(fixture.project().tracks[0]?.name, '東京 🎹 Café');
	}
});

test('cancelling an Allegro byte read publishes no tracks', async () => {
	const fixture = midiServiceFixture();
	const route = createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('Allegro must use MIDI import') },
		async () => fixture.service).importFiles;
	const cancellation = new AbortController();
	await assert.rejects(route([{ name: 'Cafe.gro', arrayBuffer: async () => {
		cancellation.abort(); return legacyBytes.slice().buffer;
	} }], { signal: cancellation.signal }), { name: 'AbortError' });
	assert.equal(fixture.project().tracks.length, 0);
});
