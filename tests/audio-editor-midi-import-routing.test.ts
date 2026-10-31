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
	const audio: unknown[][] = [];
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

test('shared MIDI import retains destination identity while its lazy service loads', async () => {
	let project = { id: 'first', sampleRate: 48_000 };
	let imported = false;
	const route = createMidiImportFiles({ getProject: () => project, importFiles: () => assert.fail('MIDI must not reach audio import') },
		async () => {
			project = { ...project };
			return { importDocument: async () => { imported = true; return []; } };
		});
	await assert.rejects(route([new File([writeMidiFile(document)], 'score.mid')]), /project changed/iu);
	assert.equal(imported, false);
});

test('ordinary file ports and recognized media retain their existing import admission without eager reads', async () => {
	const f = fixture();
	const port = { name: 'linked.wav', type: 'audio/wav', size: 1,
		arrayBuffer: async () => { assert.fail('ordinary ports must retain their existing decoder'); } };
	const ambiguousPort = { ...port, name: 'unnamed.bin' };
	const native = { name: 'Metadata.wav', slice: () => { assert.fail('native metadata reads belong to the ordinary import task'); } };
	const files = [port, ambiguousPort, native];
	assert.equal(await f.route(files), 'ordinary');
	assert.deepEqual(f.audio, [files]);
	assert.equal(f.audio[0]?.[0], port);
	assert.equal(f.audio[0]?.[1], ambiguousPort);
	assert.equal(f.audio[0]?.[2], native);
	assert.equal(f.imported.length, 0);
});

test('empty file lists preserve ordinary import cleanup for null and undefined', async () => {
	const f = fixture();
	assert.equal(await f.route(null), 'ordinary');
	assert.equal(await f.route(undefined), 'ordinary');
	assert.deepEqual(f.audio, [[], []]);
});

test('named MIDI and Allegro file ports route without requiring Blob or slice methods', async () => {
	const f = fixture();
	const bytes = await new File([writeMidiFile(document)], 'score.mid').arrayBuffer();
	const text = writeAllegroFile(document);
	await f.route([{ name: 'score.mid', arrayBuffer: async () => bytes },
		{ name: 'score.MIDI', arrayBuffer: async () => bytes },
		{ name: 'score.GRO', text: async () => text },
		{ name: 'bytes.gro', arrayBuffer: async () => new TextEncoder().encode(text).buffer }]);
	assert.equal(f.audio.length, 0);
	assert.equal(f.imported.length, 4);
	for (const value of f.imported) assert.equal(value.tracks.find(track => track.notes.length)?.notes[0]?.pitch, 60);
});

test('ambiguous files use only a bounded four-byte read to detect MIDI signatures', async () => {
	const f = fixture();
	const bytes = await new File([writeMidiFile(document)], 'score.mid').arrayBuffer();
	const ranges: number[][] = [];
	await f.route([{ name: 'score.bin', arrayBuffer: async () => bytes, slice: (start, end) => {
		ranges.push([start, end]); return { arrayBuffer: async () => bytes.slice(start, end) };
	} }]);
	assert.deepEqual(ranges, [[0, 4]]);
	assert.equal(f.audio.length, 0);
	assert.equal(f.imported.length, 1);
});

test('unreadable named MIDI and Allegro ports fail clearly without reaching the audio decoder', async () => {
	const f = fixture();
	for (const name of ['score.mid', 'score.midi', 'score.gro']) await assert.rejects(f.route([{ name }]), /requires readable/iu);
	assert.equal(f.audio.length, 0);
	assert.equal(f.imported.length, 0);
});

test('already cancelled imports perform no file reads or ordinary delegation', async () => {
	const f = fixture();
	const controller = new AbortController();
	const reason = new Error('Import cancelled');
	controller.abort(reason);
	await assert.rejects(f.route([{ name: 'unknown.bin', slice: () => { assert.fail('cancelled imports must not read'); } }],
		{ signal: controller.signal }), error => error === reason);
	assert.equal(f.audio.length, 0);
	assert.equal(f.imported.length, 0);
});

for (const phase of ['signature', 'payload'] as const) test(`MIDI ${phase} reads release cancellation while native bytes remain pending`, { timeout: 2_000 }, async () => {
	const f = fixture();
	const controller = new AbortController();
	const reason = new Error('Import cancelled');
	let entered = (): void => {};
	let release = (_bytes: ArrayBuffer): void => {};
	const started = new Promise<void>(resolve => { entered = resolve; });
	const pending = new Promise<ArrayBuffer>(resolve => { release = resolve; });
	const read = () => { entered(); return pending; };
	const file = phase === 'signature' ? { name: 'unknown.bin', slice: () => ({ arrayBuffer: read }) }
		: { name: 'score.mid', arrayBuffer: read };
	const rejected = assert.rejects(f.route([file], { signal: controller.signal }), error => error === reason);
	await started;
	controller.abort(reason);
	await rejected;
	release(await new File([writeMidiFile(document)], 'score.mid').arrayBuffer());
	await Promise.resolve();
	assert.equal(f.audio.length, 0);
	assert.equal(f.imported.length, 0);
});
