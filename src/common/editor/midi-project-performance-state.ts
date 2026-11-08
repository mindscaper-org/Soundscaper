/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiFileDocument, MidiFileEvent } from './midi-file-types.ts';
import type { MidiNote } from './midi-model.ts';

/** These are the performance controls interpreted by the beta PCM fallback. */
export function isMidiPerformanceStateEvent(event: MidiFileEvent): boolean {
	return (event.status & 240) === 224 || ((event.status & 240) === 176 && [7, 11, 64, 121].includes(event.data[0]!));
}

export function createMidiPerformanceStateProjection(events: readonly MidiFileEvent[]) {
	const defaults = new Map<string, MidiFileEvent>();
	for (const event of events) for (const change of changes(event)) defaults.set(key(change), defaultState(change));
	const windows = new Map<string, Readonly<{ state: readonly MidiFileEvent[]; undo: readonly MidiFileEvent[] }>>();
	return {
		initial(frame: number): MidiFileEvent[] { return [...defaults.values()].map(event => ({ ...event, frame })); },
		reversed(start: number, frames: number, timelineStart: number, global: (frame: number) => number): MidiFileEvent[] {
			const windowKey = `${start}:${frames}`;
			let window = windows.get(windowKey);
			if (!window) {
				const state = new Map(defaults);
				const undo: MidiFileEvent[] = [];
				for (const event of events) {
					if (event.frame >= start + frames) break;
					for (const change of changes(event)) {
						const identity = key(change);
						const before = state.get(identity)!;
						if (event.frame >= start) undo.push({ ...before, frame: event.frame });
						state.set(identity, change);
					}
				}
				window = { state: [...state.values()], undo: undo.reverse() };
				// A loop has its body and at most two partial edge windows.
				if (windows.size < 3) windows.set(windowKey, window);
			}
			return [...window.state.map(event => ({ ...event, frame: timelineStart })),
				...window.undo.map(event => ({ ...event, frame: global(event.frame) }))];
		},
	};
}

function changes(event: MidiFileEvent): readonly MidiFileEvent[] {
	if (!isMidiPerformanceStateEvent(event)) return [];
	if ((event.status & 240) !== 176 || event.data[0] !== 121) return [event];
	return [{ ...event, data: [11, 127] }, { ...event, data: [64, 0] }, { ...event, status: 224 | (event.status & 15), data: [0, 64] }];
}

function key(event: MidiFileEvent): string { return `${event.status}:${(event.status & 240) === 176 ? event.data[0] : ''}`; }

function defaultState(event: MidiFileEvent): MidiFileEvent {
	return { ...event, frame: 0, data: (event.status & 240) === 224 ? [0, 64] : [event.data[0]!, event.data[0] === 64 ? 0 : 127] };
}

export interface MidiPerformanceOccurrence {
	readonly track: number;
	readonly start: number;
	readonly end: number;
	readonly eligible: boolean;
	readonly notes: readonly MidiNote[];
	readonly events: readonly MidiFileEvent[];
}
type PerformanceBoundary = Readonly<{ frame: number; kind: 0 | 1; occurrence: MidiPerformanceOccurrence; channels: ReadonlySet<number> }>;
type PerformanceEvent = Readonly<{ frame: number; kind: 2; track: number; order: number; event: MidiFileEvent }>;
type PerformanceMarker = PerformanceBoundary | PerformanceEvent;

/** An independent full clip can restart known beta state only while its global channel is quiet. */
export function quietMidiClipPerformanceEvents(document: MidiFileDocument, occurrences: readonly MidiPerformanceOccurrence[], reserve: (count: number) => void): ReadonlyMap<number, readonly MidiFileEvent[]> {
	const added = new Map<number, MidiFileEvent[]>();
	if (!occurrences.some(occurrence => occurrence.eligible)
		|| !document.tracks.some(track => track.events?.some(isMidiPerformanceStateEvent))) return added;
	if (document.tracks.some(track => track.notes.some(note => (note.midiPort ?? 0) !== 0)
		|| track.events?.some(event => event.status === 240 || event.status === 247
			|| event.status === 255 && (event.metaType === 9 || event.metaType === 0x20
				|| event.metaType === 0x21 && event.data[0] !== 0)))) return added;
	const markers: PerformanceMarker[] = [];
	for (const occurrence of occurrences) {
		const channels = new Set([...occurrence.notes.map(note => note.channel), ...occurrence.events.filter(event => event.status < 240).map(event => event.status & 15)]);
		markers.push({ frame: occurrence.start, kind: 1, occurrence, channels }, { frame: occurrence.end, kind: 0, occurrence, channels });
	}
	for (const [track, data] of document.tracks.entries()) for (const [order, event] of (data.events ?? []).entries()) {
		if (changes(event).length) markers.push({ frame: event.frame, kind: 2, track, order, event });
	}
	markers.sort((a, b) => a.frame - b.frame || a.kind - b.kind || (a.kind === 2 && b.kind === 2 ? a.track - b.track || a.order - b.order : 0));
	const active = new Int32Array(16);
	const state = new Map<string, Readonly<{ track: number; event: MidiFileEvent }>>();
	for (let index = 0; index < markers.length;) {
		const frame = markers[index]!.frame;
		const from = index;
		while (index < markers.length && markers[index]!.frame === frame) index += 1;
		const starts: PerformanceBoundary[] = [];
		for (let cursor = from; cursor < index; cursor += 1) {
			const marker = markers[cursor]!;
			if (marker.kind === 2) continue;
			for (const channel of marker.channels) active[channel] = active[channel]! + (marker.kind === 1 ? 1 : -1);
			if (marker.kind === 1) starts.push(marker);
		}
		for (const { occurrence } of starts) {
			if (!occurrence.eligible) continue;
			const own = new Set(occurrence.events.filter(event => event.frame === frame).flatMap(changes).map(key));
			for (const channel of new Set(occurrence.notes.map(note => note.channel))) {
				if (active[channel] !== 1) continue;
				for (const controller of [7, 11, 64, null]) {
					const identity = `${(controller === null ? 224 : 176) | channel}:${controller ?? ''}`;
					const previous = state.get(identity);
					if (!previous || previous.track !== occurrence.track || own.has(identity)) continue;
					const reset = defaultState(previous.event);
					if (equivalentPerformanceState(previous.event, reset)) continue;
					reserve(1);
					const event = { ...reset, frame };
					const trackAdded = added.get(occurrence.track) ?? [];
					trackAdded.push(event); added.set(occurrence.track, trackAdded);
					state.set(identity, { track: occurrence.track, event });
				}
			}
		}
		for (let cursor = from; cursor < index; cursor += 1) {
			const marker = markers[cursor]!;
			if (marker.kind === 2) for (const event of changes(marker.event)) state.set(key(event), { track: marker.track, event });
		}
	}
	return added;
}

function equivalentPerformanceState(a: MidiFileEvent, b: MidiFileEvent): boolean {
	if ((a.status & 240) === 176 && a.data[0] === 64) return (a.data[1]! >= 64) === (b.data[1]! >= 64);
	return a.data.length === b.data.length && a.data.every((value, index) => value === b.data[index]);
}
