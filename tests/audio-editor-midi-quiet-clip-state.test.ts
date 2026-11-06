/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createMidiClip } from '../src/common/editor/midi-factory.ts';
import { withMidiTrackData } from '../src/common/editor/midi-model.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { parseAllegroFile, writeAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { validateMidiFileDocument, type MidiFileDocument, type MidiFileEvent } from '../src/common/editor/midi-file-types.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { createMidiExpressionIndex, midiNoteSoundEnd } from '../src/common/editor/engine/midi-expression.ts';
import { quietMidiClipPerformanceEvents, type MidiPerformanceOccurrence as Occurrence } from '../src/common/editor/midi-project-performance-state.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';

const note = { id: 'n', channel: 0, pitch: 69, velocity: 100, startFrame: 0, durationFrames: 4000 };
const cc = (frame: number, controller: number, value: number, channel = 0): MidiFileEvent => ({ frame, status: 176 | channel, data: [controller, value] });
const row = (start: number, end: number, events: readonly MidiFileEvent[], options: Partial<Occurrence> = {}): Occurrence => ({ track: 0, start, end, events, notes: [{ ...note, startFrame: start }], eligible: true, ...options });

for (const [controller, value, expected] of [[7, 0, 127], [11, 64, 127], [64, 127, 0]] as const) test(`a quiet default clip resets inherited CC${controller} on its own track`, async () => {
	const rows = [row(0, 8000, [cc(6000, controller, value)]), row(16000, 20000, [])];
	const { document, apply, reserved } = fixture(rows);
	const output = apply();
	assert.deepEqual(output.tracks[0]?.events, [...document.tracks[0]!.events!, cc(16000, controller, expected)]);
	assert.equal(reserved(), 1);
	if (controller === 7) {
		for (const recovered of [parseMidiFile(writeMidiFile(output), { sampleRate: 8000 }), parseAllegroFile(writeAllegroFile(output), { sampleRate: 8000 })]) {
			const delivered = recovered.tracks.find(track => track.notes.length); assert.ok(delivered);
			assert.deepEqual(renderMidiFrames(delivered.notes, 'triangle', 8000, 16000, 4000, delivered.events), renderMidiFrames([note], 'triangle', 8000, 0, 4000));
		}
		const reopened = midiServiceFixture();
		const created = (await reopened.service.importDocument(parseMidiFile(writeMidiFile(output), { sampleRate: 8000 })))[0];
		assert.ok(created);
		const clip = reopened.project().clips.find(clip => clip.id === created.clipId); assert.ok(clip);
		const samples = reopened.pcm.get(clip.sourceId)?.[0]; assert.ok(samples);
		assert.ok(samples.slice(16000, 20000).some(sample => Math.abs(sample) > 0.05));
	}
});

test('a quiet bend resets to the existing beta centre', () => {
	const { apply } = fixture([row(0, 8000, [{ frame: 6000, status: 224, data: [0, 96] }]), row(16000, 20000, [])]);
	assert.deepEqual(apply().tracks[0]?.events?.at(-1), { frame: 16000, status: 224, data: [0, 64] });
});

for (const value of [64, 127]) test(`an owner-provided startup volume ${value} is never replaced`, () => {
	const f = fixture([row(0, 8000, [cc(6000, 7, 0)]), row(16000, 20000, [cc(16000, 7, value)])]);
	assert.deepEqual(writeMidiFile(f.apply()), writeMidiFile(f.document)); assert.equal(f.reserved(), 0);
});

test('startup Reset All Controllers establishes expression, bend and pedal but leaves volume to reset', () => {
	const f = fixture([row(0, 8000, [cc(6000, 7, 0), cc(6100, 11, 12), cc(6200, 64, 127), { frame: 6300, status: 224, data: [0, 96] }]), row(16000, 20000, [cc(16000, 121, 0)])]);
	assert.deepEqual(f.apply().tracks[0]?.events, [...f.document.tracks[0]!.events!, cc(16000, 7, 127)]);
	assert.equal(f.reserved(), 1);
});

test('an earlier Reset All Controllers leaves only its unchanged volume for the next quiet clip', () => {
	const f = fixture([row(0, 8000, [cc(6000, 7, 0), cc(6100, 11, 12), cc(6200, 64, 127), { frame: 6300, status: 224, data: [0, 96] }, cc(6400, 121, 0)]), row(16000, 20000, [])]);
	assert.deepEqual(f.apply().tracks[0]?.events?.at(-1), cc(16000, 7, 127)); assert.equal(f.reserved(), 1);
});

test('same-state overlaps and simultaneous starts receive no unilateral reset', () => {
	for (const secondStart of [0, 2000]) {
		const f = fixture([row(0, 8000, [cc(0, 7, 64)]), row(secondStart, 9000, [cc(secondStart, 7, 64)], { notes: [{ ...note, pitch: 72, startFrame: secondStart }] })]);
		assert.deepEqual(writeMidiFile(f.apply()), writeMidiFile(f.document)); assert.equal(f.reserved(), 0);
	}
});

test('a causal held-pedal overlap stays byte-identical when the later key releases after the older pedal-up', () => {
	const a = row(0, 8000, [cc(0, 64, 127), cc(4000, 64, 0)], { notes: [{ ...note, durationFrames: 1000 }] });
	const b = row(2000, 8000, [], { notes: [{ ...note, pitch: 72, startFrame: 2000, durationFrames: 5000 }] });
	const f = fixture([a, b]); const output = f.apply();
	assert.deepEqual(writeMidiFile(output), writeMidiFile(f.document)); assert.equal(f.reserved(), 0);
	const delivered = parseMidiFile(writeMidiFile(output), { sampleRate: 8000 }).tracks.find(track => track.notes.length)!;
	const expression = createMidiExpressionIndex(delivered.events ?? []);
	assert.deepEqual(delivered.notes.map(note => midiNoteSoundEnd(note, expression.forNote(note))), [4000, 7000]);
});

test('a foreign same-channel occurrence blocks a reset even when the final donor is on the target track', () => {
	const f = fixture([row(0, 7500, [cc(7000, 7, 0)]), row(8000, 12000, []), row(6000, 16000, [cc(6000, 7, 0)], { track: 1, notes: [{ ...note, pitch: 72, startFrame: 6000, durationFrames: 9000 }] })]);
	assert.deepEqual(writeMidiFile(f.apply()), writeMidiFile(f.document)); assert.equal(f.reserved(), 0);
});

test('a foreign voice on a different channel does not block its independent quiet reset', () => {
	const f = fixture([row(0, 7500, [cc(7000, 7, 0)]), row(8000, 12000, []), row(6000, 16000, [cc(6000, 7, 64, 1)], { track: 1, notes: [{ ...note, channel: 1, pitch: 72, startFrame: 6000, durationFrames: 9000 }] })]);
	const output = f.apply(); assert.deepEqual(output.tracks[0]?.events?.at(-1), cc(8000, 7, 127)); assert.deepEqual(writeMidiFile({ ...output, tracks: [output.tracks[1]!] }), writeMidiFile({ ...f.document, tracks: [f.document.tracks[1]!] }));
});

test('a last nondefault donor from another output track is not rewritten', () => {
	const f = fixture([row(0, 8000, [cc(6000, 7, 0)], { track: 1 }), row(16000, 20000, [])]);
	assert.deepEqual(writeMidiFile(f.apply()), writeMidiFile(f.document)); assert.equal(f.reserved(), 0);
});

for (const later of [8000, 8001]) test(`a boundary controller ending at 8001 is quiet only for the next start ${later}`, () => {
	const f = fixture([row(0, 8001, [cc(8000, 7, 0)]), row(later, later + 4000, [])]);
	const output = f.apply(); assert.equal(f.reserved(), later === 8001 ? 1 : 0);
	if (later === 8000) assert.deepEqual(writeMidiFile(output), writeMidiFile(f.document));
});

for (const kind of ['port', 'device', 'text-prefix', 'sysex', 'transformed'] as const) test(`existing ${kind} handling remains unchanged`, () => {
	const namespace: MidiFileEvent[] = kind === 'port' ? [{ frame: 0, status: 255, metaType: 0x21, data: [1] }]
		: kind === 'device' ? [{ frame: 0, status: 255, metaType: 9, data: [68] }]
		: kind === 'text-prefix' ? [{ frame: 0, status: 255, metaType: 0x20, data: [0] }]
		: kind === 'sysex' ? [{ frame: 0, status: 240, data: [126, 127, 9, 1, 247] }] : [];
	const f = fixture([row(0, 8000, [...namespace, cc(6000, 7, 0)]), row(16000, 20000, [], { eligible: kind !== 'transformed' })]);
	assert.deepEqual(writeMidiFile(f.apply()), writeMidiFile(f.document)); assert.equal(f.reserved(), 0);
});

test('a value below the pedal threshold and a genuinely default volume need no extra metadata', () => {
	const f = fixture([row(0, 8000, [cc(6000, 7, 127), cc(6100, 64, 1)]), row(16000, 20000, [])]);
	assert.deepEqual(writeMidiFile(f.apply()), writeMidiFile(f.document)); assert.equal(f.reserved(), 0);
});

test('a refused event reservation cannot publish a partially mutated document', () => {
	const rows = [row(0, 8000, [cc(6000, 7, 0)]), row(16000, 20000, [])]; const f = fixture(rows); const before = structuredClone(f.document);
	assert.throws(() => quietMidiClipPerformanceEvents(f.document, rows, () => { throw new RangeError('MIDI export contains too many events.'); }), /too many events/u);
	assert.deepEqual(f.document, before);
});


test('a later quiet pedal reset cannot make an earlier clipped sustained tail pass its preflight', () => {
	const f = fixture([row(0, 8000, [cc(0, 64, 127)]), row(8000, 12000, [])]);
	assert.throws(() => f.apply(), /sustained note cut by a clip boundary/u);
});

function fixture(rows: readonly Occurrence[]) {
	const trackCount = Math.max(...rows.map(row => row.track)) + 1;
	const tracks = Array.from({ length: trackCount }, (_, track) => ({ name: `Track ${track}`, durationFrames: Math.max(1, ...rows.filter(row => row.track === track).map(row => row.end)),
		notes: rows.filter(row => row.track === track).flatMap(row => row.notes), events: rows.filter(row => row.track === track).flatMap(row => row.events).sort((a, b) => a.frame - b.frame) }));
	const document: MidiFileDocument = { sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [{ frame: 0, numerator: 4, denominator: 4 }], tracks };
	validateMidiFileDocument(document);
	const clips = rows.map((row, index) => createMidiClip({ id: `clip-${index}`, sourceId: `source-${index}`, title: `Clip ${index}`, timelineStartFrame: row.start,
		durationFrames: row.end - row.start, ...(row.eligible ? {} : { reversed: true }), notes: row.notes.map((note, i) => ({ ...note, id: `${index}-${i}`, startFrame: note.startFrame - row.start })),
		interchange: { events: row.events.map(event => ({ ...event, frame: event.frame - row.start })), tempos: [], signatures: [] } }));
	const project = createSoundscaperProject({ sampleRate: 8000,
		sources: rows.map((row, index) => ({ id: `source-${index}`, name: `Source ${index}`, sampleRate: 8000, channelCount: 1, frameCount: row.end - row.start, sampleFormat: 'float32', storageKey: `source-${index}` })), clips,
		tracks: tracks.map((_, track) => withMidiTrackData(createAudioTrack({ id: `track-${track}`, name: `Track ${track}`, clipIds: rows.flatMap((row, index) => row.track === track ? [`clip-${index}`] : []) }, 8000), { version: 1, instrument: 'triangle' })),
	});
	let count = 0;
	return { document, project, reserved: () => count, apply: () => {
		const output = midiDocumentFromProject({ ...project, tracks: project.tracks.map(track => ({ ...track })), clips: project.clips.map(clip => ({ ...clip })) });
		count = output.tracks.reduce((sum, track) => sum + (track.events?.length ?? 0), 0) - document.tracks.reduce((sum, track) => sum + (track.events?.length ?? 0), 0);
		validateMidiFileDocument(output);
		return output;
	} };
}
