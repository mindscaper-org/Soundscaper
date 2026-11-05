/* SPDX-License-Identifier: AGPL-3.0-only */

interface TickMessage {
	readonly tick: number;
	readonly status: number;
	readonly data: readonly number[];
	readonly metaType?: number;
}
interface NoteStart { readonly event: TickMessage; readonly track: number }
interface RoutedMessage extends NoteStart { readonly destination: string; readonly order: number }
interface NoteRelease { readonly tick: number; readonly velocity: number }

/** Synchronous SMF tracks can share a destination and release each other's keys. */
export function midiFileNoteReleases(tracks: readonly Readonly<{ events: readonly TickMessage[] }>[]): ReadonlyMap<TickMessage, NoteRelease> {
	const messages: RoutedMessage[] = [];
	for (const [track, value] of tracks.entries()) {
		let device = '', port = 0;
		for (const [order, event] of value.events.entries()) {
			if (event.status === 255 && event.metaType === 9) device = JSON.stringify(event.data);
			else if (event.status === 255 && event.metaType === 0x21 && event.data.length === 1) port = event.data[0]!;
			const type = event.status & 240;
			if (type === 128 || type === 144 || type === 176 && [120, 123, 124, 125, 126, 127].includes(event.data[0]!)) {
				messages.push({ event, track, order, destination: `${device}:${port}:${event.status & 15}` });
			}
		}
	}
	messages.sort((left, right) => left.event.tick - right.event.tick || left.track - right.track || left.order - right.order);
	const active = new Map<string, Map<number, NoteStart[]>>();
	const releases = new Map<TickMessage, NoteRelease>();
	for (const { event, track, destination } of messages) {
		const type = event.status & 240;
		const keys = active.get(destination) ?? new Map<number, NoteStart[]>();
		const pitch = event.data[0]!;
		if (type === 144 && event.data[1]) {
			const notes = keys.get(pitch) ?? [];
			notes.push({ event, track }); keys.set(pitch, notes); active.set(destination, keys);
		} else if (type === 176) {
			for (const notes of keys.values()) for (const note of notes) releases.set(note.event, { tick: event.tick, velocity: 0 });
			active.delete(destination);
		} else {
			const notes = keys.get(pitch);
			if (!notes?.length) continue;
			// Preserve each track's authored pair when several parts overlap on one key.
			const local = notes.findIndex(note => note.track === track);
			const [note] = notes.splice(Math.max(0, local), 1);
			releases.set(note!.event, { tick: event.tick, velocity: type === 128 ? event.data[1]! : 64 });
			if (!notes.length) keys.delete(pitch);
			if (!keys.size) active.delete(destination);
		}
	}
	return releases;
}
