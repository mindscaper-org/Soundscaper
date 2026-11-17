/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiFileEvent, MidiFileTrack } from './midi-file-types.ts';
import { midiImportDestinationAt, midiImportDestinationKey, midiImportNoteDestinations, midiImportSelector,
	type MidiImportDestination } from './midi-file-import-destinations.ts';

interface RoutedEvent {
	readonly source: number;
	readonly order: number;
	readonly event: MidiFileEvent;
	readonly destination?: MidiImportDestination;
}

/** Keep separately authored patch and channel controls with their unique playable owner. */
export function routeMidiImportControls(tracks: readonly MidiFileTrack[]): readonly MidiFileTrack[] {
	const owners = new Map<string, number | null>();
	for (const [index, track] of tracks.entries()) {
		const destinations = midiImportNoteDestinations(track);
		const stable = new Set(destinations.map(midiImportDestinationKey)).size === 1;
		for (const destination of destinations) {
			const key = `${destination.channel}:${midiImportDestinationKey(destination)}`;
			if (!stable) owners.set(key, null);
			else if (!owners.has(key)) owners.set(key, index);
			else if (owners.get(key) !== index) owners.set(key, null);
		}
	}
	const destinationAt = tracks.map(track => midiImportDestinationAt(track.events ?? []));
	const incoming: RoutedEvent[][] = tracks.map(() => []);
	const routed = tracks.map((track, index) => {
		if (!track.events?.length) return track;
		const retained: MidiFileEvent[] = [];
		let destination: MidiImportDestination = { port: 0 };
		for (const { event, order } of track.events.map((event, order) => ({ event, order })).sort((a, b) => a.event.frame - b.event.frame)) {
			destination = midiImportSelector(destination, event);
			const type = event.status & 0xf0;
			const channelSetup = [0xa0, 0xb0, 0xc0, 0xd0, 0xe0].includes(type);
			const key = midiImportDestinationKey(destination);
			const owner = channelSetup ? owners.get(`${event.status & 0x0f}:${key}`) : undefined;
			if (owner === undefined || owner === null || owner === index || midiImportDestinationKey(destinationAt[owner]!(event.frame)) !== key) retained.push(event);
			else incoming[owner]!.push({ source: index, order, event, destination });
		}
		return retained.length === track.events.length ? track : { ...track, events: retained };
	});
	return routed.map((track, index) => incoming[index]!.length ? {
		...track,
		events: mergedEvents(track, index, incoming[index]!),
	} : track);
}

function mergedEvents(track: MidiFileTrack, index: number, incoming: readonly RoutedEvent[]): MidiFileEvent[] {
	const entries: RoutedEvent[] = [...(track.events ?? []).map((event, order) => ({ source: index, order, event })), ...incoming]
		.sort((left, right) => left.event.frame - right.event.frame || left.source - right.source || left.order - right.order);
	const output: MidiFileEvent[] = [], delayed: RoutedEvent[] = [];
	let destination: MidiImportDestination = { port: 0 };
	for (const entry of entries) {
		if (entry.destination && midiImportDestinationKey(destination) !== midiImportDestinationKey(entry.destination)) {
			delayed.push(entry); continue;
		}
		output.push(entry.event);
		destination = midiImportSelector(destination, entry.event);
		// Every incoming event belongs to this owner's one stable namespace.
		if (delayed.length && midiImportDestinationKey(destination) === midiImportDestinationKey(delayed[0]!.destination!)) {
			for (const pending of delayed) output.push(pending.event);
			delayed.length = 0;
		}
	}
	return output;
}
