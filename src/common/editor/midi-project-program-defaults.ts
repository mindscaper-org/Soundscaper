/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiFileEvent } from './midi-file-types.ts';

interface ProgramState { track: number; msb: number; lsb: number; activeMsb: number; activeLsb: number; program: number }

export function isMidiProgramStateEvent(event: MidiFileEvent): boolean {
	return (event.status & 240) === 192 || (event.status & 240) === 176 && [0, 32].includes(event.data[0]!);
}

/** A whole independent source starts with the synth defaults, including pending bank selectors. */
export function createMidiProjectProgramDefaults() {
	const channels = new Map<number, ProgramState>();
	function observe(event: MidiFileEvent, track: number): void {
		if (!isMidiProgramStateEvent(event)) return;
		const channel = event.status & 15;
		const state = channels.get(channel) ?? { track, msb: 0, lsb: 0, activeMsb: 0, activeLsb: 0, program: 0 };
		state.track = track;
		if ((event.status & 240) === 192) {
			state.program = event.data[0]!; state.activeMsb = state.msb; state.activeLsb = state.lsb;
		} else if (event.data[0] === 0) state.msb = event.data[1]!;
		else state.lsb = event.data[1]!;
		channels.set(channel, state);
	}
	return { observe, restart(channel: number, track: number, frame: number): readonly MidiFileEvent[] {
		const state = channels.get(channel);
		if (!state || state.track !== track || ![state.msb, state.lsb, state.activeMsb, state.activeLsb, state.program].some(Boolean)) return [];
		const defaults: MidiFileEvent[] = [
			{ frame, status: 176 | channel, data: [0, 0] }, { frame, status: 176 | channel, data: [32, 0] },
			{ frame, status: 192 | channel, data: [0] },
		];
		for (const event of defaults) observe(event, track);
		return defaults;
	} };
}
