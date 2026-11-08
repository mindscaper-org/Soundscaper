/* SPDX-License-Identifier: AGPL-3.0-only */

import type { pianoRollGridMath } from './musical-clock';

interface InitialNote { readonly id: number; readonly startTime: number; readonly duration: number; }

/** A selected group shares one bounded source-time edge delta, retaining its other edge. */
export function resizePianoRollNotes(notes: readonly InitialNote[], anchorId: number,
	edge: 'resize-left' | 'resize-right', pointerDelta: number, grid: ReturnType<typeof pianoRollGridMath>) {
	const anchor = notes.find(note => note.id === anchorId)!;
	if (edge === 'resize-right') {
		const duration = Math.max(grid.durationAt(anchor.startTime, 1 / 32), grid.snapDuration(anchor.startTime, anchor.duration + pointerDelta));
		let minimumDelta = -Infinity;
		for (const note of notes) minimumDelta = Math.max(minimumDelta, Math.min(0, grid.durationAt(note.startTime, 1 / 32) - note.duration));
		const delta = Math.max(minimumDelta, duration - anchor.duration);
		return notes.map(note => ({ ...note, duration: note.duration + delta }));
	}
	const snappedStart = grid.snapTime(anchor.startTime + pointerDelta);
	let minimumStart = Infinity, maximumShift = Infinity;
	for (const note of notes) {
		minimumStart = Math.min(minimumStart, note.startTime);
		maximumShift = Math.min(maximumShift, Math.max(0, note.duration - grid.durationEndingAt(note.startTime + note.duration, 1 / 32)));
	}
	const delta = Math.max(-minimumStart, Math.min(maximumShift, snappedStart - anchor.startTime));
	return notes.map(note => ({ ...note, startTime: note.startTime + delta, duration: note.duration - delta }));
}
