/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { parseAllegroFile, writeAllegroFile } from '../src/common/editor/allegro-file.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import type { MidiFileDocument, MidiFileEvent } from '../src/common/editor/midi-file-types.ts';
import { compileMidiExpression, midiExpressionStateIndex } from '../src/common/editor/engine/midi-expression.ts';

for (const [name, events, expected] of [
	['pitch bend after reset', [
		{ frame: 0, status: 0xe2, data: [0, 80] },
		{ frame: 6000, status: 0xb2, data: [121, 0] },
		{ frame: 9000, status: 0xe2, data: [0, 96] },
	], [[0xb2, [121, 0]], [0xe2, [0, 96]]]],
	['sustain after reset', [
		{ frame: 0, status: 0xb2, data: [64, 127] },
		{ frame: 6000, status: 0xb2, data: [121, 0] },
		{ frame: 9000, status: 0xb2, data: [64, 127] },
	], [[0xb2, [121, 0]], [0xb2, [64, 127]]]],
	['bank select before program change', [
		{ frame: 0, status: 0xc2, data: [41] },
		{ frame: 6000, status: 0xb2, data: [0, 2] },
		{ frame: 9000, status: 0xc2, data: [42] },
	], [[0xb2, [0, 2]], [0xc2, [42]]]],
] as const) {
	test(`trimmed MIDI and Allegro export restore ${name} in chronological setup order`, () => {
		for (const roundtrip of [midiRoundtrip, allegroRoundtrip]) for (const sameFrame of [false, true]) {
			const imported = roundtrip(document(sameFrame ? events.map(event => ({ ...event, frame: 0 })) : events));
			const source = imported.tracks.find(track => track.notes.length)!;
			const clip = createMidiClip({ id: 'clip', sourceId: 'source', title: 'Trimmed imported MIDI',
				timelineStartFrame: 48_000, sourceStartFrame: 12_000, sourceDurationFrames: 24_000, durationFrames: 24_000,
				notes: source.notes, interchange: { events: source.events ?? [], tempos: imported.tempos, signatures: imported.signatures } });
			const track = createMidiTrack({ id: 'track', name: 'Imported', clipIds: ['clip'] });
			const exported = midiDocumentFromProject({ sampleRate: 48_000, tracks: [{ ...track }], clips: [{ ...clip }] });
			const reimported = roundtrip(exported).tracks.find(track => track.notes.length)!;
			assert.deepEqual(reimported.events?.map(event => [event.frame, event.status, event.data]), expected.map(([status, data]) => [48_000, status, data]));
			const expectedState = stateAt(source.events ?? [], 12_000);
			const actualState = stateAt(reimported.events ?? [], 48_000);
			for (const key of ['volume', 'expression', 'sustain', 'bendRatio'] as const) assert.equal(actualState[key], expectedState[key], key);
		}
	});
}

function document(events: readonly MidiFileEvent[]): MidiFileDocument {
	return { sampleRate: 48_000, tempos: [{ frame: 0, bpm: 120 }], signatures: [{ frame: 0, numerator: 4, denominator: 4 }],
		tracks: [{ name: 'Source', notes: [{ id: 'note', pitch: 60, channel: 2, velocity: 90, startFrame: 0, durationFrames: 36_000 }], events }] };
}

function midiRoundtrip(value: MidiFileDocument): MidiFileDocument { return parseMidiFile(writeMidiFile(value), { sampleRate: value.sampleRate }); }
function allegroRoundtrip(value: MidiFileDocument): MidiFileDocument { return parseAllegroFile(writeAllegroFile(value), { sampleRate: value.sampleRate }); }
function stateAt(events: readonly MidiFileEvent[], frame: number) {
	const states = compileMidiExpression(events)[2]!.states;
	return states[midiExpressionStateIndex(states, frame)]!;
}
