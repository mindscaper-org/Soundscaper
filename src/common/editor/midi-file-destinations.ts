/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiNoteDestination } from './midi-file-types.ts';

interface Message { readonly status: number; readonly data: readonly number[]; readonly metaType?: number }

/** Capture selectors at the actual NoteOn, before sample rounding merges event times. */
export function midiFileNoteDestinations(events: readonly Message[]): readonly MidiNoteDestination[] {
	const destinations = new Map<string, MidiNoteDestination>();
	const channels = new Set<number>();
	let port = 0;
	let device: readonly number[] | undefined;
	for (const event of events) {
		if (event.status === 255 && event.metaType === 9) { device = event.data; channels.clear(); }
		else if (event.status === 255 && event.metaType === 0x21 && event.data.length === 1) { port = event.data[0]!; channels.clear(); }
		else if ((event.status & 240) === 144 && event.data[1]) {
			const channel = event.status & 15;
			if (channels.has(channel)) continue;
			channels.add(channel);
			const key = JSON.stringify([channel, port, device ?? null]);
			if (!destinations.has(key)) destinations.set(key, { channel, port, ...(device === undefined ? {} : { device }) });
		}
	}
	return [...destinations.values()];
}
