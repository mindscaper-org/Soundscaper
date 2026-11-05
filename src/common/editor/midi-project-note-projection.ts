/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiClipData, MidiNote } from './midi-model.ts';
import { createMidiExpressionIndex, midiNoteSoundEnd } from './engine/midi-expression.ts';

/** A trimmed window can begin after key release while its damper-held voice still sounds. */
export function createMidiClipNoteProjection(data: MidiClipData) {
	const expression = createMidiExpressionIndex(data.interchange?.events ?? []);
	const notes = data.notes.map(note => ({ note, soundEnd: midiNoteSoundEnd(note, expression.forNote(note)) }));
	return function* project(start: number, frames: number, global: (frame: number) => number): Generator<MidiNote> {
		const reversed = global(start + frames) < global(start);
		for (const { note, soundEnd } of notes) {
			const keyEnd = note.onsetStop?.kind === 'all-notes-off' ? note.startFrame : note.startFrame + note.durationFrames;
			if (reversed && Math.min(start + frames, soundEnd) > Math.max(start, keyEnd)) {
				throw new RangeError('Reversed MIDI pedal-held tails cannot retain their key-release semantics in this delivery. Save the native project.');
			}
			if (note.onsetStop && note.startFrame >= start && note.startFrame < start + frames) {
				const startFrame = global(note.startFrame);
				const onsetStop = note.onsetStop.kind === 'all-notes-off' ? { ...note.onsetStop, frame: startFrame,
					soundEndFrame: note.onsetStop.soundEndFrame === null ? null : global(note.onsetStop.soundEndFrame) }
					: { ...note.onsetStop, frame: startFrame };
				yield { ...note, startFrame, onsetStop };
				continue;
			}
			if (note.onsetStop?.kind === 'all-sound-off') continue;
			const from = Math.max(start, note.startFrame);
			let to = Math.min(start + frames, keyEnd);
			if (!reversed && keyEnd <= start && soundEnd > start) {
				// Recreate the released voice under the replayed pedal state at the cut.
				to = Math.min(start + frames, start + 1);
			}
			if (to <= from) continue;
			yield { ...note, onsetStop: undefined, startFrame: Math.min(global(from), global(to)), durationFrames: Math.max(1, Math.abs(global(to) - global(from))) };
		}
	};
}
