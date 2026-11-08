/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiNote } from './midi-model.ts';
import { midiFileInteger } from './midi-file-types.ts';

/** Materialize absolute coordinates only after combining local time and track offset. */
export function offsetAllegroFrame(frame: number, offset: number, name: string): number {
	return midiFileInteger(Math.round(frame + offset) + 0, 0, Number.MAX_SAFE_INTEGER, name);
}

export function offsetAllegroNotes(notes: readonly MidiNote[], offset: number): MidiNote[] {
	return notes.map(note => {
		const startFrame = offsetAllegroFrame(note.startFrame, offset, 'Allegro note time');
		const endFrame = offsetAllegroFrame(note.startFrame + note.durationFrames, offset, 'Allegro note end');
		return { ...note, startFrame, durationFrames: Math.max(1, endFrame - startFrame) };
	});
}

/** A track offset moves its conductor events with the note and controller positions. */
export function offsetAllegroTiming<Value extends Readonly<{ frame: number }>>(values: readonly Value[], offset: number): Value[] {
	const shifted = values.map(value => ({ ...value, frame: Math.round(value.frame + offset) + 0 })).sort((a, b) => a.frame - b.frame);
	const root = shifted.filter(value => value.frame <= 0).at(-1) ?? shifted[0];
	return [...(root ? [{ ...root, frame: 0 }] : []), ...shifted.filter(value => value.frame > 0)];
}
