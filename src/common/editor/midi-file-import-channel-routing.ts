/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiFileEvent, MidiFileTrack } from './midi-file-types.ts';
import { midiImportDestinationAt, midiImportDestinationKey, midiImportNoteDestinations, midiImportSelector,
	type MidiImportDestination } from './midi-file-import-destinations.ts';

interface RoutedEvent {
	readonly source: number;
	readonly order: number;
	readonly event: MidiFileEvent;
	readonly destination?: MidiImportDestination;
	readonly selectPort?: boolean;
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
			if (owner == null || owner === index) { retained.push(event); continue; }
			const target = destinationAt[owner]!(event.frame);
			if (!sameDevice(target, destination)) retained.push(event);
			else incoming[owner]!.push({ source: index, order, event, destination, selectPort: target.port !== destination.port });
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
		if (!canWrite(entry, destination)) {
			delayed.push(entry); continue;
		}
		writeEvent(output, entry, destination.port);
		destination = midiImportSelector(destination, entry.event);
		// Every incoming event belongs to this owner's one stable namespace.
		if (delayed.length && canWrite(delayed[0]!, destination)) {
			for (const pending of delayed) writeEvent(output, pending, destination.port);
			delayed.length = 0;
		}
	}
	return output;
}

function sameDevice(left: MidiImportDestination, right: MidiImportDestination): boolean {
	return left.device === right.device || JSON.stringify(left.device) === JSON.stringify(right.device);
}

function canWrite(entry: RoutedEvent, destination: MidiImportDestination): boolean {
	return !entry.destination || (entry.selectPort || entry.destination.port === destination.port) && sameDevice(entry.destination, destination);
}

function writeEvent(output: MidiFileEvent[], entry: RoutedEvent, activePort: number): void {
	const port = entry.destination?.port;
	if (port === undefined || port === activePort) { output.push(entry.event); return; }
	const selector = { frame: entry.event.frame, status: 255, metaType: 0x21 };
	output.push({ ...selector, data: [port] }, entry.event, { ...selector, data: [activePort] });
}
