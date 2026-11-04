/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiFileEvent, MidiFileTrack } from '../../../midi-file-types.ts';

interface RoutedEvent {
	readonly source: number;
	readonly order: number;
	readonly event: MidiFileEvent;
}

const EXPRESSION_CONTROLLERS = new Set([7, 11, 64, 120, 121, 123]);

/** Keep separately authored channel controls with their unique playable owner. */
export function routeMidiImportControls(tracks: readonly MidiFileTrack[]): readonly MidiFileTrack[] {
	const owners = new Map<number, number | null>();
	for (const [index, track] of tracks.entries()) {
		for (const channel of new Set(track.notes.map(note => note.channel))) {
			if (!owners.has(channel)) owners.set(channel, index);
			else if (owners.get(channel) !== index) owners.set(channel, null);
		}
	}
	const incoming: RoutedEvent[][] = tracks.map(() => []);
	const routed = tracks.map((track, index) => {
		if (track.notes.length || !track.events?.length) return track;
		const retained: MidiFileEvent[] = [];
		for (const [order, event] of track.events.entries()) {
			const type = event.status & 0xf0;
			const expression = type === 0xe0 || type === 0xb0 && EXPRESSION_CONTROLLERS.has(event.data[0]!);
			const owner = expression ? owners.get(event.status & 0x0f) : undefined;
			if (owner === undefined || owner === null) retained.push(event);
			else incoming[owner]!.push({ source: index, order, event });
		}
		return retained.length === track.events.length ? track : { ...track, events: retained };
	});
	return routed.map((track, index) => incoming[index]!.length ? {
		...track,
		events: [...(track.events ?? []).map((event, order) => ({ source: index, order, event })), ...incoming[index]!]
			.sort((left, right) => left.event.frame - right.event.frame || left.source - right.source || left.order - right.order)
			.map(entry => entry.event),
	} : track);
}
