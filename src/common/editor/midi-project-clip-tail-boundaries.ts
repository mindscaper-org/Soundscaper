/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMidiExpressionIndex, midiNoteSoundEnd } from './engine/midi-expression.ts';
import type { MidiFileDocument, MidiFileEvent } from './midi-file-types.ts';
import type { MidiNote } from './midi-model.ts';

export interface MidiClipTailBoundary {
	readonly notes: readonly MidiNote[];
	readonly events: readonly MidiFileEvent[];
	readonly endFrame: number;
}

/** SMF/Allegro channel pedals cannot independently silence a native clip's ending. */
export function assertMidiClipTailBoundaries(document: MidiFileDocument, boundaries: readonly MidiClipTailBoundary[]): void {
	let end = 0;
	for (const track of document.tracks) end = Math.max(end, track.durationFrames ?? 0);
	for (const event of [...document.tempos, ...document.signatures]) end = Math.max(end, event.frame);
	const indexes = new Map<readonly MidiFileEvent[], ReturnType<typeof createMidiExpressionIndex>>();
	for (const boundary of boundaries) {
		if (boundary.endFrame >= end) continue;
		let expression = indexes.get(boundary.events);
		if (!expression) {
			expression = createMidiExpressionIndex(boundary.events);
			indexes.set(boundary.events, expression);
		}
		if (boundary.notes.some(note => {
			const timeline = expression.forNote(note);
			if (midiNoteSoundEnd(note, timeline) <= boundary.endFrame) return false;
			return note.onsetStop?.kind !== 'all-notes-off'
				|| ![timeline.pedalReleases, timeline.stops].some(frames => containsRelease(frames, note.startFrame, boundary.endFrame));
		})) {
			throw new RangeError('MIDI delivery cannot preserve a sustained note cut by a clip boundary. Export audio or save the native project.');
		}
	}
}

function containsRelease(frames: readonly number[], after: number, until: number): boolean {
	let low = 0, high = frames.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (frames[middle]! <= after) low = middle + 1; else high = middle;
	}
	return low < frames.length && frames[low]! <= until;
}
