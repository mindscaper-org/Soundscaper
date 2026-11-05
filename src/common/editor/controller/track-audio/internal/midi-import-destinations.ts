/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiFileEvent, MidiFileTrack, MidiNoteDestination } from '../../../midi-file-types.ts';

export interface MidiImportDestination { readonly port: number; readonly device?: readonly number[] }
const DEFAULT_DESTINATION: MidiImportDestination = { port: 0 };

export function midiImportDestinationKey(destination: MidiImportDestination): string {
	return JSON.stringify([destination.port, destination.device ?? null]);
}

export function midiImportSelector(previous: MidiImportDestination, event: MidiFileEvent): MidiImportDestination {
	if (event.status !== 255) return previous;
	if (event.metaType === 9) return { ...previous, device: event.data };
	if (event.metaType === 0x21 && event.data.length === 1) return { ...previous, port: event.data[0]! };
	return previous;
}

/** Parsed onset summaries avoid guessing whether a same-frame selector preceded a note. */
export function midiImportNoteDestinations(track: MidiFileTrack): readonly MidiNoteDestination[] {
	if (track.noteDestinations) return track.noteDestinations;
	const channels = [...new Set(track.notes.map(note => note.channel))];
	// Interchange authored by our editor has no selectors unless a parser supplied their authority.
	if (track.events?.some(event => event.status === 255 && [9, 0x21].includes(event.metaType ?? -1))) return [];
	return channels.map(channel => ({ channel, port: 0 }));
}

/** Query the owner's state after its selectors at a frame, without rescanning for every control. */
export function midiImportDestinationAt(events: readonly MidiFileEvent[]) {
	const selectors: { frame: number; destination: MidiImportDestination }[] = [];
	let destination = DEFAULT_DESTINATION;
	for (const event of [...events].sort((left, right) => left.frame - right.frame)) {
		const next = midiImportSelector(destination, event);
		if (next !== destination) selectors.push({ frame: event.frame, destination: next });
		destination = next;
	}
	return (frame: number): MidiImportDestination => {
		let low = 0, high = selectors.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (selectors[middle]!.frame <= frame) low = middle + 1; else high = middle;
		}
		return selectors[low - 1]?.destination ?? DEFAULT_DESTINATION;
	};
}
