/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiClipInterchange } from './midi-model.ts';
import type { MidiFileEvent } from './midi-file-types.ts';
import { createMidiPerformanceStateProjection, isMidiPerformanceStateEvent } from './midi-project-performance-state.ts';

interface OrderedEvent { readonly event: MidiFileEvent; readonly index: number }

/** One export clip owns its ordering and at most three loop-edge source windows. */
export function createMidiClipEventProjection(interchange: MidiClipInterchange | undefined) {
	const events = [...(interchange?.events ?? [])].sort(byFrame);
	const performance = createMidiPerformanceStateProjection(events);
	const windows = new Map<string, Readonly<{ initial: readonly MidiFileEvent[]; visible: readonly MidiFileEvent[] }>>();
	return {
		tempos: timingProjection(interchange?.tempos ?? []),
		signatures: timingProjection(interchange?.signatures ?? []),
		events(start: number, frames: number, timelineStart: number, global: (frame: number) => number, repeated = false): MidiFileEvent[] {
			const key = `${start}:${frames}`;
			let window = windows.get(key);
			if (!window) {
				const state = new Map<string, OrderedEvent>();
				const initial: OrderedEvent[] = [], visible: MidiFileEvent[] = [];
				for (let index = 0; index < events.length; index += 1) {
					const event = events[index]!;
					if (event.frame >= start + frames) break;
					if (event.frame >= start) visible.push(event);
					else if (event.status === 240 || event.status === 247) initial.push({ event, index });
					else if (event.status < 240) state.set(`${event.status}:${[160, 176].includes(event.status & 240) ? event.data[0] : ''}`, { event, index });
					else if (event.status === 255 && [2, 4, 89].includes(event.metaType ?? -1)) state.set(`meta:${event.metaType}`, { event, index });
				}
				window = { initial: [...initial, ...state.values()].sort((a, b) => a.index - b.index).map(value => value.event), visible };
				if (windows.size < 3) windows.set(key, window);
			}
			if (global(start + frames) < global(start)) return [
				...window.initial.filter(event => !isMidiPerformanceStateEvent(event)).map(event => ({ ...event, frame: timelineStart })),
				...window.visible.filter(event => !isMidiPerformanceStateEvent(event)).map(event => ({ ...event, frame: global(event.frame) })),
				...performance.reversed(start, frames, timelineStart, global),
			];
			return [...(repeated ? performance.initial(timelineStart) : []), ...window.initial.map(event => ({ ...event, frame: timelineStart })), ...window.visible.map(event => ({ ...event, frame: global(event.frame) }))];
		},
	};
}

function timingProjection<Value extends Readonly<{ frame: number }>>(values: readonly Value[]) {
	const sorted = values.filter(value => value.frame > 0).sort(byFrame);
	return (start: number, frames: number, timelineStart: number, global: (frame: number) => number): Value[] => {
		const first = lowerBound(sorted, start), end = lowerBound(sorted, start + frames);
		const before = first > 0 ? sorted[first - 1] : undefined;
		return [...(before ? [{ ...before, frame: timelineStart }] : []), ...sorted.slice(first, end).map(value => ({ ...value, frame: global(value.frame) }))];
	};
}

function lowerBound(values: readonly Readonly<{ frame: number }>[], frame: number): number {
	let low = 0, high = values.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (values[middle]!.frame < frame) low = middle + 1;
		else high = middle;
	}
	return low;
}

function byFrame(a: Readonly<{ frame: number }>, b: Readonly<{ frame: number }>): number { return a.frame - b.frame; }
