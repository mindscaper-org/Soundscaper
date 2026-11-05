/* SPDX-License-Identifier: AGPL-3.0-only */

/** Same-instant conductor declarations replace earlier state in source order. */
export function midiInitialTimingEvent<Event extends Readonly<{ frame: number }>>(events: readonly Event[]): Event | undefined {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		if (events[index]!.frame === 0) return events[index];
	}
	return undefined;
}
