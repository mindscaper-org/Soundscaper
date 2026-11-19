/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiClipData, MidiNote } from './midi-model.ts';
import { preflightScapeProjectJsonStructure } from './scape-project-json-preflight.ts';

export const MIDI_COMPACT_SCORE_KEY = 'soundscaper.midi.score-v1';
export const MIDI_COMPACT_SCORE_FEATURE_ID = 'org.soundscaper.capability.midi-score-v1';
const INLINE_SCORE_ITEMS = 256;
const MAXIMUM_SCORE_CODE_UNITS = 16 * 1024 * 1024;
const SCORE_STRUCTURE = { maximumTraversalNodes: 2_500_000, maximumTraversalDepth: 6 };

/** A multi-track import also shares one command budget. */
export function needsCompactMidiScore(scores: readonly MidiClipData[]): boolean {
	let items = 0;
	for (const { notes, interchange } of scores) {
		items += notes.length + (interchange?.tempos.length ?? 0) + (interchange?.signatures.length ?? 0);
		if (items > INLINE_SCORE_ITEMS) return true;
		for (const event of interchange?.events ?? []) {
			items += 1 + event.data.length;
			if (items > INLINE_SCORE_ITEMS) return true;
		}
	}
	return false;
}

/** Store dense scores as one JSON scalar at the command and project boundaries. */
export function packMidiScore(data: MidiClipData, compact: boolean): MidiClipData | string {
	if (!compact && !needsCompactMidiScore([data])) return data;
	const payload = JSON.stringify({ version: 1, notes: data.notes.map(packNote), interchange: data.interchange });
	assertScoreStructure(payload);
	return payload;
}

export function unpackMidiScore(payload: string, maximumNotes: number): unknown {
	assertScoreStructure(payload);
	const value: unknown = JSON.parse(payload);
	if (!value || typeof value !== 'object' || Reflect.get(value, 'version') !== 1) {
		throw new TypeError('Invalid compact MIDI score.');
	}
	const notes: unknown = Reflect.get(value, 'notes');
	if (!Array.isArray(notes) || notes.length > maximumNotes) throw new TypeError('Invalid compact MIDI score notes.');
	return { version: 1, notes: notes.map(unpackNote), interchange: Reflect.get(value, 'interchange') as unknown };
}

function packNote(note: MidiNote): readonly unknown[] {
	const fields = [note.id, note.startFrame, note.durationFrames, note.pitch, note.velocity, note.channel];
	return note.releaseVelocity === undefined && note.midiPort === undefined && note.onsetStop === undefined ? fields
		: [...fields, note.releaseVelocity ?? null, note.midiPort ?? null, ...(note.onsetStop === undefined ? [] : [note.onsetStop])];
}

function unpackNote(value: unknown): unknown {
	if (!Array.isArray(value) || value.length < 6 || value.length === 7 || value.length > 9) {
		throw new TypeError('Invalid compact MIDI note.');
	}
	const [id, startFrame, durationFrames, pitch, velocity, channel, releaseVelocity, midiPort, onsetStop] = value as readonly unknown[];
	return { id, startFrame, durationFrames, pitch, velocity, channel,
		releaseVelocity: releaseVelocity ?? undefined, midiPort: midiPort ?? undefined, onsetStop };
}

function assertScoreStructure(payload: string): void {
	if (payload.length > MAXIMUM_SCORE_CODE_UNITS) throw new RangeError('The compact MIDI score exceeds its text limit.');
	preflightScapeProjectJsonStructure(payload, SCORE_STRUCTURE);
}
