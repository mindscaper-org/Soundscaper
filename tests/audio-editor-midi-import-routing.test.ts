/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { writeMidiFile } from '../src/common/editor/midi-file.ts';
import { writeAllegroFile } from '../src/common/editor/allegro-file.ts';
import type { MidiFileDocument } from '../src/common/editor/midi-file-types.ts';

const document: MidiFileDocument = { sampleRate: 48_000,
	tracks: [{ name: 'Piano', notes: [{ id: 'n', pitch: 60, startFrame: 0, durationFrames: 24_000, velocity: 90, channel: 0 }] }],
	tempos: [{ frame: 0, bpm: 120 }], signatures: [{ frame: 0, numerator: 4, denominator: 4 }] };

function fixture() {
	let project = { id: 'first', sampleRate: 48_000 };
	const audio: Blob[][] = [];
	const imported: MidiFileDocument[] = [];
	const options: unknown[] = [];
	const route = createMidiImportFiles({ getProject: () => project, importFiles: files => { audio.push([...files]); return 'ordinary'; } },
		async () => ({ importDocument: async (value, settings) => { imported.push(value); options.push(settings); return []; } }));
	return { route, audio, imported, options, replace(id = 'other') { project = { id, sampleRate: 48_000 }; } };
}

test('shared import routes MIDI by signature and Allegro by extension while retaining ordinary audio', async () => {
	const f = fixture();
	const audio = new File(['RIFF'], 'recording.wav');
	await f.route([audio, new File([writeMidiFile(document)], 'unnamed.bin'), new File([writeAllegroFile(document)], 'score.GRO')], { timelineStartFrame: 12_000 });
	assert.deepEqual(f.audio, [[audio]]);
	assert.equal(f.imported.length, 2);
	assert.equal(f.imported[0]?.tracks.find(track => track.notes.length)?.notes[0]?.pitch, 60);
	assert.equal(f.imported[1]?.tracks[0]?.notes[0]?.velocity, 90);
	assert.deepEqual(f.options, [{ timelineStartFrame: 12_000 }, { timelineStartFrame: 12_000 }]);
});

test('ordinary files retain batch routing and malformed MIDI never falls through to an audio decoder', async () => {
	const f = fixture();
	const files = [new File(['RIFF'], 'a.wav'), new File(['fLaC'], 'b.flac')];
	assert.equal(await f.route(files), 'ordinary');
	assert.deepEqual(f.audio, [files]);
	await assert.rejects(f.route([new File(['broken'], 'bad.mid')]));
	assert.equal(f.audio.length, 1);
	assert.equal(f.imported.length, 0);
});

test('shared MIDI import refuses a project switch during byte reading', async () => {
	const f = fixture();
	const file = new File([writeMidiFile(document)], 'score.mid');
	const bytes = await file.arrayBuffer();
	Object.defineProperty(file, 'arrayBuffer', { value: () => { f.replace(); return Promise.resolve(bytes); } });
	await assert.rejects(f.route([file]), /project changed/iu);
	assert.equal(f.imported.length, 0);
});

test('shared MIDI import refuses replacing a document with another revision of the same project', async () => {
	const f = fixture();
	const file = new File([writeMidiFile(document)], 'score.mid');
	const bytes = await file.arrayBuffer();
	Object.defineProperty(file, 'arrayBuffer', { value: () => { f.replace('first'); return Promise.resolve(bytes); } });
	await assert.rejects(f.route([file]), /project changed/iu);
	assert.equal(f.imported.length, 0);
});
