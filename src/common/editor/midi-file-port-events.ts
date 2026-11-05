/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MidiPortTickEvent {
	readonly tick: number;
	readonly status: number;
	readonly data: readonly number[];
	readonly metaType?: number;
	readonly order?: number;
	readonly midiPort?: number;
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
