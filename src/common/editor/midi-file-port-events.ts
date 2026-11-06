/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MidiPortTickEvent {
	readonly tick: number;
	/** Source-frame order survives events collapsing onto one emitted tick. */
	readonly frame?: number;
	readonly status: number;
	readonly data: readonly number[];
	readonly metaType?: number;
	readonly order?: number;
	readonly midiPort?: number;
	readonly textChannel?: number | null;
}

/** Restore the auxiliary stream's selector after each authored note message. */
export function* midiPortEvents(events: readonly MidiPortTickEvent[], budget: { remaining: number }): Generator<MidiPortTickEvent> {
	let port = 0;
	for (const event of events) {
		if (event.midiPort !== undefined && event.midiPort !== port) {
			if (budget.remaining < 2) throw new RangeError('MIDI export exceeds the reader event limit.');
			budget.remaining -= 2;
			yield { tick: event.tick, status: 255, metaType: 0x21, data: [event.midiPort] };
			yield event;
			yield { tick: event.tick, status: 255, metaType: 0x21, data: [port] };
		} else yield event;
		if (event.status === 255 && event.metaType === 0x21 && event.data.length === 1) port = event.data[0]!;
	}
}

/** Recreate known text scope without inventing MIDI channel messages to clear it. */
export function* midiTextChannelEvents(events: Iterable<MidiPortTickEvent>, budget: { remaining: number }): Generator<MidiPortTickEvent> {
	let channel: number | null = null;
	for (const event of events) {
		if (event.textChannel !== undefined && event.textChannel !== channel) {
			if (event.textChannel === null) throw new RangeError('MIDI text channel association cannot be cleared without its original channel message. Save the native project.');
			if (budget.remaining-- <= 0) throw new RangeError('MIDI export exceeds the reader event limit.');
			channel = event.textChannel;
			yield { tick: event.tick, status: 255, metaType: 0x20, data: [channel] };
		}
		yield event;
		if (event.status < 240) channel = null;
		else if (event.status === 255 && event.metaType === 0x20 && event.data.length === 1 && event.data[0]! <= 15) channel = event.data[0]!;
	}
}
