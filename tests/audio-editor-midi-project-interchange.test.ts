/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import type { MidiClipInterchange, MidiNote } from '../src/common/editor/midi-model.ts';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { parseAllegroFile, writeAllegroFile } from '../src/common/editor/allegro-file.ts';
import { MIDI_FILE_MAX_EVENTS, type MidiFileDocument } from '../src/common/editor/midi-file-types.ts';

const note = (id: string, startFrame: number, durationFrames: number, pitch = 60): MidiNote => ({ id, startFrame, durationFrames, pitch, channel: 2, velocity: 90 });
function fixture(options: Readonly<Record<string, unknown>> = {}, interchange?: MidiClipInterchange) {
	const clip = createMidiClip({ id: 'clip', sourceId: 'source', title: 'Clip', timelineStartFrame: 1000,
		sourceStartFrame: 100, sourceDurationFrames: 200, durationFrames: 400,
		notes: [note('hidden', 0, 50), note('left', 50, 100), note('middle', 150, 100, 64), note('right', 250, 100, 67)],
		...options, ...(interchange ? { interchange } : {}) });
	const track = createMidiTrack({ id: 'track', name: 'Lead', clipIds: ['clip'], program: 40 });
	return { sampleRate: 48_000, tracks: [{ ...track }], clips: [{ ...clip }], tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 } } };
}

test('MIDI project export clips source-relative notes to trimmed, moved and stretched timeline geometry', () => {
	const project = fixture();
	const before = structuredClone(project);
	const exported = midiDocumentFromProject(project);
	assert.deepEqual(exported.tracks[0]?.notes.map(n => [n.id, n.startFrame, n.durationFrames, n.pitch, n.channel]), [
		['clip:left', 1000, 100, 60, 2], ['clip:middle', 1100, 200, 64, 2], ['clip:right', 1300, 100, 67, 2],
	]);
	assert.equal(exported.tracks[0]?.program, 40);
	assert.deepEqual(project, before);
});

test('MIDI project export restores pre-trim program/controller state and maps visible events', () => {
	const exported = midiDocumentFromProject(fixture({}, { tempos: [], signatures: [], events: [
		{ frame: 0, status: 0xc2, data: [41] },
		{ frame: 0, status: 0xb2, data: [64, 64] },
		{ frame: 50, status: 0xb2, data: [64, 127] },
		{ frame: 125, status: 0xb2, data: [64, 0] },
		{ frame: 350, status: 0xb2, data: [64, 127] },
	] }));
	assert.deepEqual(exported.tracks[0]?.events, [
		{ frame: 1000, status: 0xc2, data: [41] },
		{ frame: 1000, status: 0xb2, data: [64, 127] },
		{ frame: 1050, status: 0xb2, data: [64, 0] },
	]);
});

test('MIDI project export preserves imported later timing changes while current project root always wins', () => {
	const interchange: MidiClipInterchange = { events: [], tempos: [{ frame: 0, bpm: 120 }, { frame: 150, bpm: 90 }],
		signatures: [{ frame: 0, numerator: 4, denominator: 4 }, { frame: 200, numerator: 3, denominator: 4 }] };
	const project = fixture({}, interchange);
	const exported = midiDocumentFromProject(project);
	assert.deepEqual(exported.tempos, [{ frame: 0, bpm: 120 }, { frame: 1100, bpm: 90 }]);
	assert.deepEqual(exported.signatures, [{ frame: 0, numerator: 4, denominator: 4 }, { frame: 1200, numerator: 3, denominator: 4 }]);
	const edited = midiDocumentFromProject({ ...project, tempo: { bpm: 150, timeSignature: { numerator: 6, denominator: 8 } } });
	assert.deepEqual(edited.tempos, [{ frame: 0, bpm: 150 }]);
	assert.deepEqual(edited.signatures, [{ frame: 0, numerator: 6, denominator: 8 }]);
});

test('MIDI project export projects explicit tempo/signature maps and ignores stale imported maps', () => {
	const project = fixture({}, { events: [], tempos: [{ frame: 0, bpm: 120 }, { frame: 150, bpm: 90 }], signatures: [] });
	const exported = midiDocumentFromProject({ ...project,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }, { beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } }] },
		signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }, { bar: 1, numerator: 3, denominator: 4 }, { bar: 2, numerator: 6, denominator: 8 }] },
	});
	assert.deepEqual(exported.tempos, [{ frame: 0, bpm: 120 }, { frame: 96_000, bpm: 60 }]);
	assert.deepEqual(exported.signatures, [{ frame: 0, numerator: 4, denominator: 4 }, { frame: 96_000, numerator: 3, denominator: 4 }, { frame: 240_000, numerator: 6, denominator: 8 }]);
});

test('MIDI project export resolves musical clip anchors and reverses note placement with the fallback', () => {
	const musical = fixture({ anchor: 'musical', musicalStartBeat: { num: 2, den: 1 }, musicalExtent: 'beat', musicalDurationBeats: { num: 4, den: 1 } });
	assert.equal(midiDocumentFromProject(musical).tracks[0]?.notes[0]?.startFrame, 48_000);
	const reversed = midiDocumentFromProject(fixture({ reversed: true }));
	assert.deepEqual(reversed.tracks[0]?.notes.map(n => [n.pitch, n.startFrame, n.durationFrames]), [
		[60, 1300, 100], [64, 1100, 200], [67, 1000, 100],
	]);
});

test('MIDI project export rejects absent MIDI and invalid geometry instead of publishing corrupt files', () => {
	assert.throws(() => midiDocumentFromProject({ sampleRate: 48_000, tracks: [], clips: [] }), /no MIDI/i);
	const project = fixture();
	assert.throws(() => midiDocumentFromProject({ ...project, clips: [{ ...project.clips[0], sourceDurationFrames: 0 }] }), /duration|geometry|positive/i);
});

test('MIDI project export follows authored audio warp timing for notes and expressive messages', () => {
	const project = fixture({ warpMap: { feature: 'audio-warp', points: [
		{ outer: { num: 0, den: 1 }, source: { num: 100, den: 1 }, mode: 'forward' },
		{ outer: { num: 300, den: 1 }, source: { num: 200, den: 1 }, mode: 'forward' },
		{ outer: { num: 400, den: 1 }, source: { num: 300, den: 1 }, mode: 'forward' },
	] } }, { tempos: [], signatures: [], events: [{ frame: 150, status: 0xe2, data: [0, 80] }] });
	const exported = midiDocumentFromProject(project);
	assert.deepEqual(exported.tracks[0]?.notes.map(n => [n.pitch, n.startFrame, n.durationFrames]), [
		[60, 1000, 150], [64, 1150, 200], [67, 1350, 50],
	]);
	assert.deepEqual(exported.tracks[0]?.events, [{ frame: 1150, status: 0xe2, data: [0, 80] }]);
	assertInterchangeRoundtrip(exported);
});

test('MIDI project export resolves musical warp points through the project tempo map', () => {
	const project = fixture({ anchor: 'musical', musicalStartBeat: { num: 2, den: 1 },
		musicalExtent: 'beat', musicalDurationBeats: { num: 4, den: 1 }, warpMap: { feature: 'audio-warp', points: [
			{ outer: { num: 0, den: 1 }, source: { num: 100, den: 1 }, mode: 'forward' },
			{ outer: { num: 3, den: 1 }, source: { num: 200, den: 1 }, mode: 'forward' },
			{ outer: { num: 4, den: 1 }, source: { num: 300, den: 1 }, mode: 'forward' },
		] } });
	const exported = midiDocumentFromProject({ ...project, tempoMap: { mode: 'musical', events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
		{ beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
	] } });
	assert.deepEqual(exported.tracks[0]?.notes.map(n => [n.pitch, n.startFrame, n.durationFrames]), [
		[60, 48_000, 36_000], [64, 84_000, 84_000], [67, 168_000, 24_000],
	]);
	assertInterchangeRoundtrip(exported);
});

test('MIDI project export repeats loop notes and controllers with partial final periods', () => {
	const project = fixture({}, { tempos: [], signatures: [], events: [{ frame: 150, status: 0xb2, data: [1, 100] }] });
	const clip = loopingFixtureClip(project);
	const loop = { ...clip, ...clipLoopUpdateFields(clip, { periodFrames: 400, durationFrames: 1000 }) };
	const exported = midiDocumentFromProject({ ...project, clips: [loop] });
	assert.deepEqual(exported.tracks[0]?.notes.map(n => [n.pitch, n.startFrame, n.durationFrames]), [
		[60, 1000, 100], [64, 1100, 200], [67, 1300, 100],
		[60, 1400, 100], [64, 1500, 200], [67, 1700, 100],
		[60, 1800, 100], [64, 1900, 100],
	]);
	assert.deepEqual(exported.tracks[0]?.events?.map(event => event.frame), [1100, 1500, 1900]);
	assertInterchangeRoundtrip(exported);
});

test('MIDI project export keeps loop offsets and reversed source orientation', () => {
	const project = fixture({ reversed: true });
	const clip = loopingFixtureClip(project);
	const loop = { ...clip, ...clipLoopUpdateFields(clip, { periodFrames: 400, offsetFrames: 150, durationFrames: 500 }) };
	const exported = midiDocumentFromProject({ ...project, clips: [loop] });
	assert.deepEqual(exported.tracks[0]?.notes.map(n => [n.pitch, n.startFrame, n.durationFrames]), [
		[60, 1150, 100], [64, 1000, 150], [64, 1350, 150], [67, 1250, 100],
	]);
	assertInterchangeRoundtrip(exported);
});

test('MIDI project export refuses loop expansion beyond the interchange event budget', () => {
	const project = fixture();
	const clip = loopingFixtureClip(project);
	const loop = { ...clip, ...clipLoopUpdateFields(clip, { periodFrames: 400, durationFrames: 400 * (MIDI_FILE_MAX_EVENTS + 1) }) };
	assert.throws(() => midiDocumentFromProject({ ...project, clips: [loop] }), /too many loop repetitions/i);
});

function loopingFixtureClip(project: ReturnType<typeof fixture>) {
	const clip = project.clips[0]!;
	assert.ok(typeof clip.durationFrames === 'number');
	return { ...clip, durationFrames: clip.durationFrames };
}

function assertInterchangeRoundtrip(document: MidiFileDocument): void {
	const content = (value: MidiFileDocument) => value.tracks.filter(track => track.notes.length).map(track => ({
		notes: track.notes.map(({ id: _id, onsetStop, ...note }) => ({ ...note, ...(onsetStop ? { onsetStop } : {}) }))
			.sort((a, b) => a.startFrame - b.startFrame || a.pitch - b.pitch),
		events: (track.events ?? []).filter(event => (event.status & 240) !== 192),
	}));
	assert.deepEqual(content(parseMidiFile(writeMidiFile(document), { sampleRate: document.sampleRate })), content(document));
	assert.deepEqual(content(parseAllegroFile(writeAllegroFile(document), { sampleRate: document.sampleRate })), content(document));
}
