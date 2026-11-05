/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiClipData, MidiNote } from './midi-model.ts';
import { compileMidiExpression, midiNoteSoundEnd } from './engine/midi-expression.ts';

/** A trimmed window can begin after key release while its damper-held voice still sounds. */
export function createMidiClipNoteProjection(data: MidiClipData) {
	const expression = compileMidiExpression(data.interchange?.events ?? []);
	const notes = data.notes.map(note => ({ note, soundEnd: midiNoteSoundEnd(note, expression[note.channel]!) }));
	return function* project(start: number, frames: number, global: (frame: number) => number): Generator<MidiNote> {
		const reversed = global(start + frames) < global(start);
		for (const { note, soundEnd } of notes) {
			const from = Math.max(start, note.startFrame);
			const keyEnd = note.startFrame + note.durationFrames;
			let to = Math.min(start + frames, keyEnd);
			if (!reversed && keyEnd <= start && soundEnd > start) {
				// Recreate the released voice under the replayed pedal state at the cut.
				to = Math.min(start + frames, start + 1);
			}
			if (to <= from) continue;
			yield { ...note, startFrame: Math.min(global(from), global(to)), durationFrames: Math.max(1, Math.abs(global(to) - global(from))) };
		}
	};
}
