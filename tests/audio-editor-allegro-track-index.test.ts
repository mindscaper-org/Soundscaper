/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiTrack } from '../src/common/editor/midi-model.ts';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

for (const explicit of [false, true]) test(`FileImport preserves absolute track slots with explicit headers=${explicit}`, async () => {
	const text = (explicit ? '#track 0\n#track 1\n' : '') + '#track 2 Lead\nT0 V0 P60 U0.125 L100\n';
	const fixture = midiServiceFixture();
	await createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('GRO must use MIDI import') }, async () => fixture.service).importFiles([new File([text], 'Three tracks.gro')]);
	assert.ok(validateAudioEditorProjectV17(JSON.parse(JSON.stringify(fixture.project()))));
	assert.deepEqual(fixture.project().tracks.filter(readMidiTrack).map(track => track.name), ['MIDI 1', 'MIDI 2', 'Lead']);
	assert.equal(fixture.project().clips.length, 3);
	await fixture.service.exportFile('midi'); const bytes = fixture.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	assert.deepEqual(parseMidiFile(bytes).tracks.filter(track => !track.conductorOnly).map(track => track.name), ['MIDI 1', 'MIDI 2', 'Lead']);
});

test('absolute track materialization retains later explicit names and source index ordering', () => {
	const document = parseAllegroFile('#track 3 High\nT0 V0 P60 U0.125\n#track 1 Middle\nT0 V0 P62 U0.125\n#track 0 First\nT0 V0 P64 U0.125\n');
	assert.deepEqual(document.tracks.map(track => track.name), ['First', 'Middle', 'MIDI 3', 'High']);
	assert.deepEqual(document.tracks.map(track => track.notes.map(note => note.pitch)), [[64], [62], [], [60]]);
});

test('a sparse empty track header retains the complete empty lane inventory', () => {
	const document = parseAllegroFile('#track 2 Empty third\n');
	assert.deepEqual(document.tracks.map(track => [track.name, track.notes.length]), [['MIDI 1', 0], ['MIDI 2', 0], ['Empty third', 0]]);
});

test('the largest admitted absolute track index stays within parser and project capacity', async () => {
	const fixture = midiServiceFixture();
	const document = parseAllegroFile('#track 255 Last\nT0 V0 P60 U0.125 L100\n', { sampleRate: 8000 });
	await fixture.service.importDocument(document);
	assert.ok(validateAudioEditorProjectV17(JSON.parse(JSON.stringify(fixture.project()))));
	assert.equal(fixture.project().tracks.filter(readMidiTrack).length, 256);
	assert.equal(fixture.project().clips.length, 256);
	await fixture.service.exportFile('midi'); const bytes = fixture.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const roundtrip = parseMidiFile(bytes);
	assert.equal(roundtrip.tracks.length, 256);
	assert.equal(roundtrip.tracks[255]?.name, 'Last');
	assert.throws(() => parseAllegroFile('#track 256 Beyond capacity\n'), /Allegro track/iu);
});
