/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { compileMidiExpression, midiExpressionStateIndex } from '../src/common/editor/engine/midi-expression.ts';
import type { MidiFileEvent } from '../src/common/editor/midi-file-types.ts';

const cc = (frame: number, controller: number, value: number): MidiFileEvent => ({ frame, status: 0xb2, data: [controller, value] });
const bend = (frame: number, value: number): MidiFileEvent => ({ frame, status: 0xe2, data: [0, value] });

test('reversing an imported MIDI clip reverses held performance states at their actual transition boundaries', () => {
	for (const events of [
		[cc(0, 7, 0), cc(0, 11, 40), cc(24_000, 7, 127), cc(24_000, 11, 110), cc(24_000, 64, 127), bend(24_000, 96)],
		[cc(0, 7, 30), cc(0, 11, 30), cc(12_000, 7, 80), cc(12_000, 11, 0), bend(12_000, 96), cc(30_000, 121, 0)],
	]) {
		const { project, sourceEvents } = fixture(events, 48_000);
		const clip = { ...project.clips[0]!, reversed: true };
		const exported = reopenEvents(midiDocumentFromProject({ ...project, clips: [clip] }));
		for (const frame of [5000, 20_000, 35_000, 45_000]) assert.deepEqual(stateAt(exported, frame), stateAt(sourceEvents, 48_000 - frame - 1), `reverse frame ${frame}`);
	}
});

test('looped MIDI export resets performance controls to the source initial state before every repetition', () => {
	const { project, sourceEvents } = fixture([cc(12_000, 7, 20), cc(12_000, 11, 40), cc(12_000, 64, 127), bend(12_000, 96)], 24_000);
	const clip = project.clips[0]!;
	const loop = { ...clip, ...clipLoopUpdateFields({ ...clip, durationFrames: 24_000 }, { periodFrames: 24_000, durationFrames: 72_000 }) };
	const exported = reopenEvents(midiDocumentFromProject({ ...project, clips: [loop] }));
	for (const frame of [5000, 18_000, 29_000, 42_000, 53_000, 66_000]) assert.deepEqual(stateAt(exported, frame), stateAt(sourceEvents, frame % 24_000), `loop frame ${frame}`);
});

function fixture(events: readonly MidiFileEvent[], frames: number) {
	const imported = parseMidiFile(writeMidiFile({ sampleRate: 48_000, tempos: [{ frame: 0, bpm: 120 }], signatures: [],
		tracks: [{ name: 'Performance', durationFrames: frames, notes: [{ id: 'n', pitch: 60, channel: 2, velocity: 90, startFrame: 0, durationFrames: frames }], events }] }));
	const content = imported.tracks.find(track => track.notes.length)!;
	const clip = createMidiClip({ id: 'clip', sourceId: 'source', title: 'Imported', timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: frames, durationFrames: frames, notes: content.notes, interchange: { events: content.events ?? [], tempos: imported.tempos, signatures: imported.signatures } });
	const track = createMidiTrack({ id: 'track', name: 'MIDI', clipIds: ['clip'] });
	return { sourceEvents: content.events ?? [], project: { sampleRate: 48_000, tracks: [{ ...track }], clips: [{ ...clip }] } };
}

function reopenEvents(document: ReturnType<typeof midiDocumentFromProject>): readonly MidiFileEvent[] {
	return parseMidiFile(writeMidiFile(document)).tracks.find(track => track.notes.length)?.events ?? [];
}

function stateAt(events: readonly MidiFileEvent[], frame: number) {
	const states = compileMidiExpression(events)[2]!.states;
	const state = states[midiExpressionStateIndex(states, frame)]!;
	return { volume: state.volume, expression: state.expression, sustain: state.sustain, bendRatio: state.bendRatio };
}
