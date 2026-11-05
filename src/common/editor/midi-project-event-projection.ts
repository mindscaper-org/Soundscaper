/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiClipInterchange } from './midi-model.ts';
import type { MidiFileEvent } from './midi-file-types.ts';
import { createMidiPerformanceStateProjection, isMidiPerformanceStateEvent } from './midi-project-performance-state.ts';

interface OrderedEvent { readonly event: MidiFileEvent; readonly index: number }

/** One export clip owns its ordering and at most three loop-edge source windows. */
export function createMidiClipEventProjection(interchange: MidiClipInterchange | undefined) {
	const events = [...(interchange?.events ?? [])].sort(byFrame);
	const performance = createMidiPerformanceStateProjection(events);
	const portRouted = events.some(event => event.status === 255 && event.metaType === 0x21 && event.data[0] !== 0);
	const portPerformance = portRouted && events.some(isMidiPerformanceStateEvent);
	const portPatchSetup = portRouted && events.some(isMidiPatchSetup);
	const windows = new Map<string, Readonly<{ initial: readonly MidiFileEvent[]; visible: readonly MidiFileEvent[] }>>();
	return {
		tempos: timingProjection(interchange?.tempos ?? []),
		signatures: timingProjection(interchange?.signatures ?? []),
		events(start: number, frames: number, timelineStart: number, global: (frame: number) => number, repeated = false): MidiFileEvent[] {
			if (portPatchSetup && global(start + frames) < global(start)) {
				throw new RangeError('Reversed MIDI port-aware program or bank setup cannot be preserved by this delivery. Save the native project.');
			}
			if (portPerformance && (repeated || global(start + frames) < global(start))) {
				throw new RangeError('Reversed or repeated MIDI port-aware performance state cannot be preserved by this delivery. Save the native project.');
			}
			const key = `${start}:${frames}`;
			let window = windows.get(key);
			if (!window) {
				const routed = events.some(event => event.frame < start && event.status === 255 && [9, 0x21].includes(event.metaType ?? -1));
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
						// Replaying routed setup retains each namespace, including the
						// default port before its first selector, without folding them together.
						if (routed) { initial.push(ordered); continue; }
						// Parameter selectors and data operations form an ordered program:
						// repeated increments and values for earlier selections cannot fold.
						if (type === 176 && [6, 38, 96, 97, 98, 99, 100, 101].includes(event.data[0]!)) {
							initial.push(ordered);
							continue;
						}
						state.set(`${event.status}:${[160, 176].includes(type) ? event.data[0] : ''}`, ordered);
						if (type === 176 && [0, 32].includes(event.data[0]!)) {
							const selected = banks.get(channel) ?? new Map<number, OrderedEvent>();
							selected.set(event.data[0]!, ordered); banks.set(channel, selected);
						} else if (type === 192) programBanks.set(channel, [...(banks.get(channel)?.values() ?? [])]);
					}
					else if (routed && event.status === 255 && [9, 0x21].includes(event.metaType ?? -1)) initial.push({ event, index });
					else if (event.status === 255 && event.metaType === 0x54 && event.conductor !== false) {
						throw new RangeError('MIDI export cannot preserve SMPTE synchronization after trimming its source origin.');
					} else if (event.status === 255 && [2, 4, 9, 0x21, 89].includes(event.metaType ?? -1)) state.set(`meta:${event.metaType}`, { event, index });
				}
				const firstChannel = initial.find(value => value.event.status < 240);
				const firstPort = initial.find(value => value.event.status === 255 && value.event.metaType === 0x21);
				if (routed && firstChannel && (!firstPort || firstChannel.index < firstPort.index)) {
					initial.unshift({ index: -1, event: { frame: start, status: 255, metaType: 0x21, data: [0] } });
				}
				// Bank Select is pending state: the active patch also needs the bank at its last Program Change.
				const retained = new Map([...initial, ...state.values(), ...[...programBanks.values()].flat()].map(value => [value.index, value]));
				window = { initial: [...retained.values()].sort((a, b) => a.index - b.index).map(value => value.event), visible };
				if (windows.size < 3) windows.set(key, window);
			}
			const reversed = global(start + frames) < global(start);
			if (reversed && window.visible.some(event => isReverseSetup(event) && event.frame > start)) {
				throw new RangeError('Reversed MIDI device, program, or bank changes cannot be preserved by this delivery. Save the native project.');
			}
			if (reversed) return [
				...window.initial.filter(event => !isMidiPerformanceStateEvent(event)).map(event => ({ ...event, frame: timelineStart })),
				...window.visible.filter(event => !isMidiPerformanceStateEvent(event)).map(event => ({ ...event, frame: isReverseSetup(event) ? timelineStart : global(event.frame) })),
				...performance.reversed(start, frames, timelineStart, global),
			];
			return [...(repeated ? performance.initial(timelineStart) : []), ...window.initial.map(event => ({ ...event, frame: timelineStart })), ...window.visible.map(event => ({ ...event, frame: global(event.frame) }))];
		},
	};
}

function isReverseSetup(event: MidiFileEvent): boolean {
	return event.status === 255 && event.metaType === 9 || isMidiPatchSetup(event);
}

function isMidiPatchSetup(event: MidiFileEvent): boolean {
	return (event.status & 240) === 192
		|| (event.status & 240) === 176 && [0, 32].includes(event.data[0]!);
}

function timingProjection<Value extends Readonly<{ frame: number }>>(values: readonly Value[]) {
	const sorted = values.filter(value => value.frame > 0).sort(byFrame);
	let origin: Value | undefined;
	for (const value of values) if (value.frame === 0) origin = value;
	return (start: number, frames: number, timelineStart: number, global: (frame: number) => number, initialize = false): Value[] => {
		const first = lowerBound(sorted, start), end = lowerBound(sorted, start + frames);
		// A repeated changing clock must restart from its own origin, including metronome fields.
		const before = first > 0 ? sorted[first - 1] : initialize && sorted.length > 0 && global(start + frames) > global(start) ? origin : undefined;
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
