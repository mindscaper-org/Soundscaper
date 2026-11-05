/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiFileEvent } from './midi-file-types.ts';

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
