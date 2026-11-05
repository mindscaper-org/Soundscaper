/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiFileDocument, MidiNoteDestination } from './midi-file-types.ts';
import { midiFileNoteReleaseId } from './midi-file-note-releases.ts';

interface Message { readonly status: number; readonly data: readonly number[]; readonly metaType?: number }
interface TimedMessage extends Message { readonly tick: number; readonly midiPort?: number; readonly releaseId?: string }
interface ProgramRelease { readonly tick: number; readonly allSoundOff?: true; readonly allNotesOff?: Readonly<{ id: string }> }
interface RoutedProgramMessage {
	readonly event: TimedMessage;
	readonly track: number;
	readonly order: number;
	readonly destination: string;
	readonly frame: number;
	readonly writeOrder: number;
}

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

/** Refuse only a changed onset patch when the source order cannot survive export. */
export function assertMidiFileProgramOrder(tracks: readonly Readonly<{ events: readonly TimedMessage[] }>[],
	frame: (tick: number) => number, releases: ReadonlyMap<TimedMessage, ProgramRelease>,
	writeClock: () => (frame: number) => number, canonical = false): void {
	if (!tracks.some(track => track.events.some(event => (event.status & 240) === 192))) return;
	const messages: RoutedProgramMessage[] = [];
	for (const [track, value] of tracks.entries()) {
		let device = '', port = 0;
		const local: Omit<RoutedProgramMessage, 'writeOrder'>[] = [];
		const panics = new Map<string, number>(), keyReleases = new Map<string, number>();
		for (const [order, event] of value.events.entries()) {
			if (event.status === 255 && event.metaType === 9) device = JSON.stringify(event.data);
			else if (event.status === 255 && event.metaType === 33 && event.data.length === 1) port = event.data[0]!;
			const type = event.status & 240;
			if (type !== 192 && type !== 176 && !(type === 144 && event.data[1])) continue;
			const at = frame(event.tick), destination = `${device}:${String(type === 144 ? event.midiPort ?? port : port)}:${String(event.status & 15)}`;
			if (type === 176 && event.data[0] !== 0 && event.data[0] !== 32) {
				const key = `${String(at)}:${destination}`;
				if (event.data[0] === 120 && !panics.has(key)) panics.set(key, order);
				else if ([123, 124, 125, 126, 127].includes(event.data[0]!)) keyReleases.set(`${event.releaseId ?? midiFileNoteReleaseId(track, order)}:${key}`, order);
			} else local.push({ event, track, order, destination, frame: at });
		}
		for (const entry of local) {
			const release = releases.get(entry.event);
			let writeOrder = (entry.event.status & 240) === 144 ? Number.POSITIVE_INFINITY : entry.order;
			if (release && frame(release.tick) === entry.frame) {
				const key = `${String(entry.frame)}:${entry.destination}`;
				const donor = release.allNotesOff ? keyReleases.get(`${release.allNotesOff.id}:${key}`)
					: release.allSoundOff ? panics.get(key) : undefined;
				// A foreign causal donor already requires native save at MIDI delivery.
				if ((release.allSoundOff || release.allNotesOff) && donor === undefined) continue;
				if (donor !== undefined) writeOrder = donor - 0.5;
			}
			messages.push({ ...entry, writeOrder });
		}
	}
	messages.sort((a, b) => a.event.tick - b.event.tick || a.track - b.track || (canonical ? a.writeOrder - b.writeOrder : 0) || a.order - b.order);
	const programs = new Map<string, string>(), original = new Map<TimedMessage, string | undefined>();
	const banks = new Map<string, [number | null, number | null]>();
	const update = ({ event, destination }: RoutedProgramMessage): void => {
		if ((event.status & 240) === 176) {
			const bank: [number | null, number | null] = banks.get(destination) ?? [null, null];
			bank[event.data[0] === 0 ? 0 : 1] = event.data[1]!;
			banks.set(destination, bank);
		} else programs.set(destination, JSON.stringify([event.data[0], ...(banks.get(destination) ?? [null, null])]));
	};
	for (const entry of messages) {
		if ((entry.event.status & 240) === 144) original.set(entry.event, programs.get(entry.destination));
		else update(entry);
	}
	const tick = writeClock(), writtenTick = new Map<number, number>();
	for (const entry of messages) if (!writtenTick.has(entry.frame)) writtenTick.set(entry.frame, tick(entry.frame));
	messages.sort((a, b) => writtenTick.get(a.frame)! - writtenTick.get(b.frame)! || a.track - b.track
		|| a.writeOrder - b.writeOrder || a.event.tick - b.event.tick || a.order - b.order);
	programs.clear(); banks.clear();
	for (const entry of messages) {
		if ((entry.event.status & 240) !== 144) update(entry);
		else if (original.get(entry.event) !== programs.get(entry.destination)) {
			throw new RangeError(canonical
				? 'MIDI export cannot preserve program order at a note onset. Move the Program Change farther from that onset or save the native project.'
				: 'MIDI program order cannot preserve a note onset assignment. Move the Program Change to a distinct time before importing.');
		}
	}
}

/** A later tempo edit may merge retained sample positions into one output tick. */
export function assertMidiFileWrittenProgramOrder(document: MidiFileDocument, tick: (frame: number) => number): void {
	if (!document.tracks.some(track => track.events?.some(event => (event.status & 240) === 192))) return;
	const releases = new Map<TimedMessage, ProgramRelease>();
	const tracks = document.tracks.map(track => {
		const events: TimedMessage[] = (track.events ?? []).map(event => ({ ...event, tick: event.frame }));
		if (track.program !== undefined && !events.some(event => (event.status & 240) === 192)) events.push({ tick: 0, status: 192, data: [track.program] });
		for (const note of track.notes) {
			const event: TimedMessage = { tick: note.startFrame, status: 144 | note.channel, data: [note.pitch, note.velocity], midiPort: note.midiPort };
			events.push(event);
			if (note.onsetStop) releases.set(event, { tick: note.startFrame, ...(note.onsetStop.kind === 'all-sound-off'
				? { allSoundOff: true as const } : { allNotesOff: { id: note.onsetStop.releaseId } }) });
		}
		return { events };
	});
	assertMidiFileProgramOrder(tracks, frame => frame, releases, () => tick, true);
}
