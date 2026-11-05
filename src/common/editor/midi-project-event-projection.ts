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
				const banks = new Map<number, Map<number, OrderedEvent>>();
				const programBanks = new Map<number, readonly OrderedEvent[]>();
				const initial: OrderedEvent[] = [], visible: MidiFileEvent[] = [];
				for (let index = 0; index < events.length; index += 1) {
					const event = events[index]!;
					if (event.frame >= start + frames) break;
					if (event.frame >= start) visible.push(event);
					else if (event.status === 240 || event.status === 247) initial.push({ event, index });
					else if (event.status < 240) {
						const type = event.status & 240, channel = event.status & 15;
						const ordered = { event, index };
						state.set(`${event.status}:${[160, 176].includes(type) ? event.data[0] : ''}`, ordered);
						if (type === 176 && [0, 32].includes(event.data[0]!)) {
							const selected = banks.get(channel) ?? new Map<number, OrderedEvent>();
							selected.set(event.data[0]!, ordered); banks.set(channel, selected);
						} else if (type === 192) programBanks.set(channel, [...(banks.get(channel)?.values() ?? [])]);
					}
					else if (event.status === 255 && event.metaType === 0x54 && event.conductor !== false) {
						throw new RangeError('MIDI export cannot preserve SMPTE synchronization after trimming its source origin.');
					} else if (event.status === 255 && [2, 4, 9, 0x21, 89].includes(event.metaType ?? -1)) state.set(`meta:${event.metaType}`, { event, index });
				}
				// Bank Select is pending state: the active patch also needs the bank at its last Program Change.
				const retained = new Map([...initial, ...state.values(), ...[...programBanks.values()].flat()].map(value => [value.index, value]));
				window = { initial: [...retained.values()].sort((a, b) => a.index - b.index).map(value => value.event), visible };
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
