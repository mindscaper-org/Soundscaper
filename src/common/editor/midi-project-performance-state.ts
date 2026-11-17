/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiFileDocument, MidiFileEvent } from './midi-file-types.ts';
import type { MidiNote } from './midi-model.ts';
import { createMidiProjectProgramDefaults, isMidiProgramStateEvent } from './midi-project-program-defaults.ts';

/** These are the performance controls interpreted by the beta PCM fallback. */
export function isMidiPerformanceStateEvent(event: MidiFileEvent): boolean {
	return (event.status & 240) === 224 || ((event.status & 240) === 176 && [7, 10, 11, 64, 121].includes(event.data[0]!));
}

export function createMidiPerformanceStateProjection(events: readonly MidiFileEvent[], volumeDefault = 127) {
	const defaults = new Map<string, MidiFileEvent>();
	for (const event of events) for (const change of changes(event)) defaults.set(key(change), defaultState(change, volumeDefault));
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

function defaultState(event: MidiFileEvent, volumeDefault = 127): MidiFileEvent {
	return { ...event, frame: 0, data: (event.status & 240) === 224 ? [0, 64] : [event.data[0]!, event.data[0] === 7 ? volumeDefault : event.data[0] === 10 ? 64 : event.data[0] === 64 ? 0 : 127] };
}

export interface MidiPerformanceOccurrence {
	readonly track: number;
	readonly start: number;
	readonly end: number;
	readonly eligible: boolean;
	readonly notes: readonly MidiNote[];
	readonly events: readonly MidiFileEvent[];
	readonly volumeDefault?: number;
}
type PerformanceBoundary = Readonly<{ frame: number; kind: 0 | 1; occurrence: MidiPerformanceOccurrence; channels: ReadonlySet<number> }>;
type PerformanceEvent = Readonly<{ frame: number; kind: 2; track: number; order: number; event: MidiFileEvent }>;
type PerformanceMarker = PerformanceBoundary | PerformanceEvent;

/** An independent full clip can restart known channel state only while its global channel is quiet. */
export function quietMidiClipPerformanceEvents(document: MidiFileDocument, occurrences: readonly MidiPerformanceOccurrence[], reserve: (count: number) => void): ReadonlyMap<number, readonly MidiFileEvent[]> {
	const added = new Map<number, MidiFileEvent[]>();
	if (!occurrences.some(occurrence => occurrence.eligible)
		|| !document.tracks.some(track => track.program !== undefined || track.events?.some(event => quietChanges(event).length || isMidiProgramStateEvent(event)))) return added;
	if (document.tracks.some(track => track.notes.some(note => (note.midiPort ?? 0) !== 0)
		|| track.events?.some(event => event.status === 240 || event.status === 247
			|| event.status === 255 && (event.metaType === 9 || event.metaType === 0x20
				|| event.metaType === 0x21 && event.data[0] !== 0)))) return added;
	const markers: PerformanceMarker[] = [];
	for (const occurrence of occurrences) {
		const channels = new Set([...occurrence.notes.map(note => note.channel), ...occurrence.events.filter(event => event.status < 240).map(event => event.status & 15)]);
		markers.push({ frame: occurrence.start, kind: 1, occurrence, channels }, { frame: occurrence.end, kind: 0, occurrence, channels });
	}
	for (const [track, data] of document.tracks.entries()) {
		if (data.program !== undefined && !data.events?.some(event => (event.status & 240) === 192)) {
			markers.push({ frame: 0, kind: 2, track, order: -1, event: { frame: 0, status: 192, data: [data.program] } });
		}
		for (const [order, event] of (data.events ?? []).entries()) if (quietChanges(event).length || isMidiProgramStateEvent(event)) markers.push({ frame: event.frame, kind: 2, track, order, event });
	}
	markers.sort((a, b) => a.frame - b.frame || a.kind - b.kind || (a.kind === 2 && b.kind === 2 ? a.track - b.track || a.order - b.order : 0));
	const active = new Int32Array(16);
	const state = new Map<string, Readonly<{ track: number; event: MidiFileEvent }>>();
	const programs = createMidiProjectProgramDefaults();
	const append = (track: number, event: MidiFileEvent): void => {
		reserve(1); const trackAdded = added.get(track) ?? []; trackAdded.push(event); added.set(track, trackAdded);
	};
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
			const own = new Set(occurrence.events.filter(event => event.frame === frame).flatMap(quietChanges).map(key));
			for (const channel of new Set(occurrence.notes.map(note => note.channel))) {
				if (active[channel] !== 1) continue;
				for (const controller of [1, 7, 10, 11, 64, null]) {
					const identity = `${(controller === null ? 224 : 176) | channel}:${controller ?? ''}`;
					const previous = state.get(identity);
					if (!previous || previous.track !== occurrence.track || own.has(identity)) continue;
					const reset = quietDefault(previous.event, occurrence.volumeDefault ?? 127);
					if (equivalentPerformanceState(previous.event, reset)) continue;
					const event = { ...reset, frame };
					append(occurrence.track, event);
					state.set(identity, { track: occurrence.track, event });
				}
				for (const event of programs.restart(channel, occurrence.track, frame)) append(occurrence.track, event);
			}
		}
		for (let cursor = from; cursor < index; cursor += 1) {
			const marker = markers[cursor]!;
			if (marker.kind === 2) {
				for (const event of quietChanges(marker.event)) state.set(key(event), { track: marker.track, event });
				programs.observe(marker.event, marker.track);
			}
		}
	}
	return added;
}

function quietChanges(event: MidiFileEvent): readonly MidiFileEvent[] {
	if ((event.status & 240) === 176 && event.data[0] === 1) return [event];
	const values = changes(event);
	return (event.status & 240) === 176 && event.data[0] === 121 ? [...values, { ...event, data: [1, 0] }] : values;
}

function quietDefault(event: MidiFileEvent, volume: number): MidiFileEvent {
	return (event.status & 240) === 176 && (event.data[0] === 1 || event.data[0] === 7)
		? { ...event, frame: 0, data: [event.data[0]!, event.data[0] === 1 ? 0 : volume] } : defaultState(event);
}

function equivalentPerformanceState(a: MidiFileEvent, b: MidiFileEvent): boolean {
	if ((a.status & 240) === 176 && a.data[0] === 64) return (a.data[1]! >= 64) === (b.data[1]! >= 64);
	return a.data.length === b.data.length && a.data.every((value, index) => value === b.data[index]);
}
