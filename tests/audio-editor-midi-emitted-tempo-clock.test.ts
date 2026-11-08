/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

// Valid SMF1, PPQ9600; 100 tempo changes use exactly243331/1268150µs per quarter.
// Original PortSMF independently confirms the note at11.3527s. This fixed input
// cannot change alongside the writer under test.
const source = Uint8Array.from(Buffer.from([
	'TVRoZAAAAAYAAQACJYBNVHJrAAADIAD/UQMDtoO+c/9RAxNZtoIY/1EDA7aDoQr/UQMTWbaKcf9RAwO2g49+/1EDE1m2i2D/UQMD',
	'toPAbf9RAxNZtoZB/1EDA7aDrxL/UQMTWbaHIv9RAwO2g58W/1EDE1m2hFv/UQMDtoOPKP9RAxNZtowc/1EDA7aDjHX/UQMTWbaK',
	'X/9RAwO2g7gQ/1EDE1m2ijT/UQMDtoO2Of9RAxNZtnf/UQMDtoOzKv9RAxNZtoVx/1EDA7aDvzT/UQMTWbaJYv9RAwO2g5Yj/1ED',
	'E1m2gR7/UQMDtoOOHf9RAxNZtjv/UQMDtoOpDf9RAxNZtoVX/1EDA7aDg1X/UQMTWbaHRv9RAwO2g6UC/1EDE1m2hUX/UQMDtoOS',
	'TP9RAxNZtoFK/1EDA7aDljr/UQMTWbaCF/9RAwO2g4EG/1EDE1m2TP9RAwO2g5Jx/1EDE1m2gmP/UQMDtoOlBP9RAxNZtoZS/1ED',
	'A7aDgn7/UQMTWbaKUv9RAwO2g7sS/1EDE1m2ggT/UQMDtoOVW/9RAxNZtoFK/1EDA7aDgRD/UQMTWbaGVf9RAwO2g6A2/1EDE1m2',
	'hmn/UQMDtoOpXv9RAxNZtoMQ/1EDA7aDhDP/UQMTWbaJbP9RAwO2g4x//1EDE1m2iTD/UQMDtoOyVP9RAxNZtodO/1EDA7aDrXL/',
	'UQMTWbaCAf9RAwO2g7oY/1EDE1m2glf/UQMDtoOOPf9RAxNZtowv/1EDA7aDu1P/UQMTWbaCNP9RAwO2g5Yo/1EDE1m2iWr/UQMD',
	'toOYKv9RAxNZtoVL/1EDA7aDnSr/UQMTWbaHYf9RAwO2g6Qj/1EDE1m2hET/UQMDtoOlfv9RAxNZtoEK/1EDA7aDtUj/UQMTWbaJ',
	'af9RAwO2g7cI/1EDE1m2ii3/UQMDtoOEIv9RAxNZtoJn/1EDA7aDsA3/UQMTWbaBWv9RAwO2g7d9/1EDE1m2iEb/UQMDtoO2GP9R',
	'AxNZtoR2/1EDA7aDrlP/UQMTWbaFHP9RAwO2g6Qf/1EDE1m2igb/UQMDtoOHbP9RAxNZtoFg/1EDA7aDrEv/UQMTWbYA/y8ATVRy',
	'awAAABkA/wMGUnViYXRvj/JdkDxahXWAPAAA/y8A',
].join(''), 'base64'));

test('ordinary MIDI import and re-export retain the emitted conductor clock', async () => {
	const fixture = midiServiceFixture({ sampleRate: 48_000 });
	await createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('MIDI must use MIDI import') },
		async () => fixture.service).importFiles([new File([source], 'Rubato.mid')]);
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	const document = midiDocumentFromProject(fixture.project());
	const desired = document.tracks.flatMap(track => track.notes)[0];
	assert.ok(desired);
	assert.equal(desired.startFrame, 544_930);
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	const output = parseMidiFile(bytes, { sampleRate: 48_000 });
	const note = output.tracks.flatMap(track => track.notes)[0];
	assert.ok(note);
	const halfTick = 1_268_150 * 48_000 / (9600 * 1_000_000) / 2;
	assert.ok(Math.abs(note.startFrame - desired.startFrame) <= Math.ceil(halfTick),
		`note moved from ${desired.startFrame} to ${note.startFrame}, beyond half-tick ${halfTick}`);
	assert.ok(Math.abs(note.startFrame + note.durationFrames - desired.startFrame - desired.durationFrames) <= Math.ceil(halfTick));
	assert.equal(output.tempos.length, document.tempos.length);
	for (const [index, tempo] of output.tempos.entries()) {
		assert.ok(Math.abs(tempo.frame - document.tempos[index]!.frame) <= Math.ceil(halfTick), `tempo ${index}`);
		assert.equal(Math.round(60_000_000 / tempo.bpm), Math.round(60_000_000 / document.tempos[index]!.bpm));
	}
});

for (const tempos of [[{ frame: 0, bpm: 47.313 }], [{ frame: 0, bpm: 246.578 }, { frame: 48_000, bpm: 47.313 }]]) {
	test(`ordinary ${tempos.length}-event tempo map stays within its emitted tick grid`, () => {
		const output = parseMidiFile(writeMidiFile({ sampleRate: 48_000, tempos, signatures: [], tracks: [{ name: 'Control',
			notes: [{ id: 'n', startFrame: 544_930, durationFrames: 4800, pitch: 60, velocity: 90, channel: 0 }] }] }), { sampleRate: 48_000 });
		const note = output.tracks.flatMap(track => track.notes)[0];
		assert.ok(note);
		assert.ok(Math.abs(note.startFrame - 544_930) <= 4);
		assert.equal(output.tempos.length, tempos.length);
	});
}
